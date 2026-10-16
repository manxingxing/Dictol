use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;

#[napi(object)]
pub struct WindowsScreenCaptureImage {
    pub png: Buffer,
    pub width: u32,
    pub height: u32,
    pub backend: String,
}

#[napi(object)]
pub struct WindowsDisplayBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[napi]
pub fn get_windows_display_bounds_at_point(x: i32, y: i32) -> Result<WindowsDisplayBounds> {
    #[cfg(windows)]
    {
        let (x, y, width, height) = display_bounds_at(x, y).map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("Windows display bounds failed: {error}"),
            )
        })?;
        Ok(WindowsDisplayBounds {
            x,
            y,
            width,
            height,
        })
    }
    #[cfg(not(windows))]
    {
        let _ = (x, y);
        Err(Error::new(
            Status::GenericFailure,
            "Windows display bounds requires Windows",
        ))
    }
}

pub struct CaptureWindowsScreenRegionTask {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

pub struct CaptureWindowsDisplayAtPointTask {
    x: i32,
    y: i32,
}

impl Task for CaptureWindowsDisplayAtPointTask {
    type Output = WindowsScreenCaptureImage;
    type JsValue = WindowsScreenCaptureImage;

    fn compute(&mut self) -> Result<Self::Output> {
        #[cfg(windows)]
        {
            let (x, y, width, height) = display_bounds_at(self.x, self.y).map_err(|error| {
                Error::new(
                    Status::GenericFailure,
                    format!("Windows screen capture failed: {error}"),
                )
            })?;
            let (png, backend) = capture_with_fallback(x, y, width, height).map_err(|error| {
                Error::new(
                    Status::GenericFailure,
                    format!("Windows screen capture failed: {error}"),
                )
            })?;
            Ok(WindowsScreenCaptureImage {
                png: png.into(),
                width,
                height,
                backend: backend.into(),
            })
        }
        #[cfg(not(windows))]
        {
            let _ = (self.x, self.y);
            Err(Error::new(
                Status::GenericFailure,
                "Windows screen capture requires Windows",
            ))
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi(ts_return_type = "Promise<WindowsScreenCaptureImage>")]
pub fn capture_windows_display_at_point(
    x: i32,
    y: i32,
) -> AsyncTask<CaptureWindowsDisplayAtPointTask> {
    AsyncTask::new(CaptureWindowsDisplayAtPointTask { x, y })
}

impl Task for CaptureWindowsScreenRegionTask {
    type Output = WindowsScreenCaptureImage;
    type JsValue = WindowsScreenCaptureImage;

    fn compute(&mut self) -> Result<Self::Output> {
        #[cfg(windows)]
        {
            let (png, backend) = capture_with_fallback(self.x, self.y, self.width, self.height)
                .map_err(|error| {
                    Error::new(
                        Status::GenericFailure,
                        format!("Windows screen capture failed: {error}"),
                    )
                })?;
            Ok(WindowsScreenCaptureImage {
                png: png.into(),
                width: self.width,
                height: self.height,
                backend: backend.into(),
            })
        }
        #[cfg(not(windows))]
        {
            let _ = (self.x, self.y, self.width, self.height);
            Err(Error::new(
                Status::GenericFailure,
                "Windows screen capture requires Windows",
            ))
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi(ts_return_type = "Promise<WindowsScreenCaptureImage>")]
pub fn capture_windows_screen_region(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<AsyncTask<CaptureWindowsScreenRegionTask>> {
    if width == 0 || height == 0 {
        return Err(Error::new(Status::InvalidArg, "Invalid screen region"));
    }
    Ok(AsyncTask::new(CaptureWindowsScreenRegionTask {
        x,
        y,
        width,
        height,
    }))
}

#[cfg(windows)]
fn capture_with_fallback(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> windows::core::Result<(Vec<u8>, &'static str)> {
    match capture(x, y, width, height) {
        Ok(png) => Ok((png, "wgc")),
        Err(wgc_error) => capture_gdi(x, y, width, height)
            .map(|png| (png, "gdi"))
            .map_err(|gdi_error| {
                capture_error(&format!(
                    "Windows Graphics Capture failed: {wgc_error}; GDI fallback failed: {gdi_error}"
                ))
            }),
    }
}

#[cfg(windows)]
fn capture_gdi(x: i32, y: i32, width: u32, height: u32) -> windows::core::Result<Vec<u8>> {
    use windows::Win32::Graphics::Gdi::{
        BI_RGB, BITMAPINFO, BitBlt, CAPTUREBLT, CreateCompatibleBitmap, CreateCompatibleDC,
        DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits, HBITMAP, HDC, HGDIOBJ, ROP_CODE,
        ReleaseDC, SRCCOPY, SelectObject,
    };
    use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize};

    struct Resources {
        screen: HDC,
        memory: HDC,
        bitmap: HBITMAP,
        previous: Option<HGDIOBJ>,
    }
    impl Drop for Resources {
        fn drop(&mut self) {
            unsafe {
                if let Some(previous) = self.previous.take() {
                    SelectObject(self.memory, previous);
                }
                if !self.bitmap.is_invalid() {
                    let _ = DeleteObject(self.bitmap.into());
                }
                if !self.memory.is_invalid() {
                    let _ = DeleteDC(self.memory);
                }
                if !self.screen.is_invalid() {
                    ReleaseDC(None, self.screen);
                }
            }
        }
    }
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe { RoUninitialize() };
        }
    }

    let center_x = i32::try_from(i64::from(x) + i64::from(width / 2))
        .map_err(|_| capture_error("Invalid capture coordinates"))?;
    let center_y = i32::try_from(i64::from(y) + i64::from(height / 2))
        .map_err(|_| capture_error("Invalid capture coordinates"))?;
    let (display_x, display_y, display_width, display_height) =
        display_bounds_at(center_x, center_y)?;
    if x < display_x
        || y < display_y
        || i64::from(x) + i64::from(width) > i64::from(display_x) + i64::from(display_width)
        || i64::from(y) + i64::from(height) > i64::from(display_y) + i64::from(display_height)
    {
        return Err(capture_error("Capture region must fit within one display"));
    }
    let w = i32::try_from(width).map_err(|_| capture_error("Invalid capture width"))?;
    let h = i32::try_from(height).map_err(|_| capture_error("Invalid capture height"))?;
    let mut resources = Resources {
        screen: unsafe { GetDC(None) },
        memory: HDC::default(),
        bitmap: HBITMAP::default(),
        previous: None,
    };
    if resources.screen.is_invalid() {
        return Err(capture_error("Could not access desktop DC"));
    }
    resources.memory = unsafe { CreateCompatibleDC(Some(resources.screen)) };
    if resources.memory.is_invalid() {
        return Err(capture_error("Could not create capture DC"));
    }
    resources.bitmap = unsafe { CreateCompatibleBitmap(resources.screen, w, h) };
    if resources.bitmap.is_invalid() {
        return Err(capture_error("Could not create capture bitmap"));
    }
    let previous = unsafe { SelectObject(resources.memory, resources.bitmap.into()) };
    if previous.is_invalid() {
        return Err(capture_error("Could not select capture bitmap"));
    }
    resources.previous = Some(previous);
    let blit = unsafe {
        BitBlt(
            resources.memory,
            0,
            0,
            w,
            h,
            Some(resources.screen),
            x,
            y,
            ROP_CODE(SRCCOPY.0 | CAPTUREBLT.0),
        )
    };
    unsafe { SelectObject(resources.memory, previous) };
    resources.previous = None;
    blit?;

    let mut info = BITMAPINFO::default();
    info.bmiHeader.biSize = std::mem::size_of_val(&info.bmiHeader) as u32;
    info.bmiHeader.biWidth = w;
    info.bmiHeader.biHeight = -h; // Top-down pixels match the OCR image coordinates.
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB.0;
    let byte_count = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| capture_error("Screenshot is too large"))?;
    let mut pixels = vec![0; byte_count];
    let lines = unsafe {
        GetDIBits(
            resources.screen,
            resources.bitmap,
            0,
            height,
            Some(pixels.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    if lines != h {
        return Err(capture_error("Could not read capture bitmap"));
    }
    for pixel in pixels.chunks_exact_mut(4) {
        pixel[3] = 255;
    }
    drop(resources);
    unsafe { RoInitialize(RO_INIT_MULTITHREADED)? };
    let _apartment = Apartment;
    encode_png(&pixels, width, height)
}

#[cfg(windows)]
fn capture(x: i32, y: i32, width: u32, height: u32) -> windows::core::Result<Vec<u8>> {
    use std::sync::mpsc::{self, RecvTimeoutError};
    use std::time::Duration;
    use windows::Foundation::TypedEventHandler;
    use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem};
    use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
    use windows::Graphics::DirectX::DirectXPixelFormat;
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
    use windows::Win32::Graphics::Direct3D11::{
        D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION, D3D11CreateDevice, ID3D11Device,
    };
    use windows::Win32::Graphics::Dxgi::IDXGIDevice;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MONITOR_DEFAULTTONULL, MONITORINFO, MonitorFromPoint,
    };
    use windows::Win32::System::WinRT::Direct3D11::CreateDirect3D11DeviceFromDXGIDevice;
    use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
    use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize};
    use windows::core::{Error as WinError, IInspectable, Interface, factory};

    struct WinRtApartment;
    impl Drop for WinRtApartment {
        fn drop(&mut self) {
            unsafe { RoUninitialize() };
        }
    }

    unsafe { RoInitialize(RO_INIT_MULTITHREADED)? };
    let _apartment = WinRtApartment;

    let mid_x = i64::from(x) + i64::from(width / 2);
    let mid_y = i64::from(y) + i64::from(height / 2);
    let point = POINT {
        x: i32::try_from(mid_x).map_err(|_| capture_error("Invalid capture coordinates"))?,
        y: i32::try_from(mid_y).map_err(|_| capture_error("Invalid capture coordinates"))?,
    };
    let monitor = unsafe { MonitorFromPoint(point, MONITOR_DEFAULTTONULL) };
    if monitor.is_invalid() {
        return Err(capture_error("Capture region is outside a display"));
    }
    let mut monitor_info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if !unsafe { GetMonitorInfoW(monitor, &mut monitor_info) }.as_bool() {
        return Err(WinError::from_thread());
    }
    let monitor_rect = monitor_info.rcMonitor;
    let right = i64::from(x) + i64::from(width);
    let bottom = i64::from(y) + i64::from(height);
    if x < monitor_rect.left
        || y < monitor_rect.top
        || right > i64::from(monitor_rect.right)
        || bottom > i64::from(monitor_rect.bottom)
    {
        return Err(capture_error("Capture region must fit within one display"));
    }
    let crop_x = (x - monitor_rect.left) as u32;
    let crop_y = (y - monitor_rect.top) as u32;

    let interop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
    let item = unsafe { interop.CreateForMonitor::<GraphicsCaptureItem>(monitor)? };
    let mut d3d_device = None;
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            Default::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut d3d_device),
            None,
            None,
        )?
    };
    let d3d_device: ID3D11Device = d3d_device.ok_or_else(|| capture_error("No D3D11 device"))?;
    let dxgi_device: IDXGIDevice = d3d_device.cast()?;
    let inspectable = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi_device)? };
    let winrt_device: IDirect3DDevice = inspectable.cast()?;
    let frame_pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
        &winrt_device,
        DirectXPixelFormat::B8G8R8A8UIntNormalized,
        1,
        item.Size()?,
    )?;

    let (sender, receiver) = mpsc::sync_channel(1);
    let handler =
        TypedEventHandler::<Direct3D11CaptureFramePool, IInspectable>::new(move |pool, _| {
            let result = pool
                .as_ref()
                .ok_or_else(|| capture_error("Capture frame pool was closed"))
                .and_then(|pool| pool.TryGetNextFrame())
                .and_then(|frame| {
                    let result = read_frame(&d3d_device, &frame, crop_x, crop_y, width, height);
                    let _ = frame.Close();
                    result
                });
            let _ = sender.try_send(result);
            Ok(())
        });
    let token = frame_pool.FrameArrived(&handler)?;
    let session = frame_pool.CreateCaptureSession(&item)?;
    // The cursor obscures the word under it. Older Windows builds may lack this property.
    let _ = session.SetIsCursorCaptureEnabled(false);
    let started = session.StartCapture();
    let result = match started {
        Ok(()) => receiver
            .recv_timeout(Duration::from_secs(3))
            .unwrap_or_else(|error| {
                Err(match error {
                    RecvTimeoutError::Timeout => {
                        capture_error("Timed out waiting for a screen frame")
                    }
                    RecvTimeoutError::Disconnected => capture_error("Screen capture stopped"),
                })
            }),
        Err(error) => Err(error),
    };
    let _ = session.Close();
    let _ = frame_pool.RemoveFrameArrived(token);
    let _ = frame_pool.Close();
    let pixels = result?;
    encode_png(&pixels, width, height)
}

#[cfg(windows)]
fn display_bounds_at(x: i32, y: i32) -> windows::core::Result<(i32, i32, u32, u32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MONITOR_DEFAULTTONULL, MONITORINFO, MonitorFromPoint,
    };
    use windows::core::Error as WinError;

    let monitor = unsafe { MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONULL) };
    if monitor.is_invalid() {
        return Err(capture_error("Capture point is outside a display"));
    }
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        return Err(WinError::from_thread());
    }
    let rect = info.rcMonitor;
    let width = u32::try_from(i64::from(rect.right) - i64::from(rect.left))
        .map_err(|_| capture_error("Invalid display width"))?;
    let height = u32::try_from(i64::from(rect.bottom) - i64::from(rect.top))
        .map_err(|_| capture_error("Invalid display height"))?;
    Ok((rect.left, rect.top, width, height))
}

#[cfg(windows)]
fn read_frame(
    device: &windows::Win32::Graphics::Direct3D11::ID3D11Device,
    frame: &windows::Graphics::Capture::Direct3D11CaptureFrame,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> windows::core::Result<Vec<u8>> {
    use windows::Win32::Graphics::Direct3D11::{
        D3D11_BOX, D3D11_CPU_ACCESS_READ, D3D11_MAP_READ, D3D11_MAPPED_SUBRESOURCE,
        D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING, ID3D11Resource, ID3D11Texture2D,
    };
    use windows::Win32::System::WinRT::Direct3D11::IDirect3DDxgiInterfaceAccess;
    use windows::core::Interface;

    let surface = frame.Surface()?;
    let access: IDirect3DDxgiInterfaceAccess = surface.cast()?;
    let texture = unsafe { access.GetInterface::<ID3D11Texture2D>()? };
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { texture.GetDesc(&mut desc) };
    let content = frame.ContentSize()?;
    if x.checked_add(width)
        .is_none_or(|right| right > desc.Width || right > content.Width as u32)
        || y.checked_add(height)
            .is_none_or(|bottom| bottom > desc.Height || bottom > content.Height as u32)
    {
        return Err(capture_error("Capture region exceeds the available frame"));
    }
    desc.Width = width;
    desc.Height = height;
    desc.BindFlags = 0;
    desc.MiscFlags = 0;
    desc.Usage = D3D11_USAGE_STAGING;
    desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
    let mut staging = None;
    unsafe { device.CreateTexture2D(&desc, None, Some(&mut staging))? };
    let staging = staging.ok_or_else(|| capture_error("Could not allocate capture texture"))?;
    let context = unsafe { device.GetImmediateContext()? };
    let region = D3D11_BOX {
        left: x,
        top: y,
        right: x + width,
        bottom: y + height,
        front: 0,
        back: 1,
    };
    unsafe {
        context.CopySubresourceRegion(
            Some(&staging.cast()?),
            0,
            0,
            0,
            0,
            Some(&texture.cast()?),
            0,
            Some(&region),
        );
    }
    let resource: ID3D11Resource = staging.cast()?;
    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    unsafe { context.Map(Some(&resource), 0, D3D11_MAP_READ, 0, Some(&mut mapped))? };
    let row_size = width as usize * 4;
    let mut pixels = vec![0; row_size * height as usize];
    for row in 0..height as usize {
        let source = unsafe {
            std::slice::from_raw_parts(
                (mapped.pData as *const u8).add(row * mapped.RowPitch as usize),
                row_size,
            )
        };
        pixels[row * row_size..(row + 1) * row_size].copy_from_slice(source);
    }
    unsafe { context.Unmap(Some(&resource), 0) };
    Ok(pixels)
}

#[cfg(windows)]
fn encode_png(pixels: &[u8], width: u32, height: u32) -> windows::core::Result<Vec<u8>> {
    use windows::Graphics::Imaging::{BitmapEncoder, BitmapPixelFormat, SoftwareBitmap};
    use windows::Storage::Streams::{DataReader, DataWriter, InMemoryRandomAccessStream};

    let writer = DataWriter::new()?;
    writer.WriteBytes(pixels)?;
    let buffer = writer.DetachBuffer()?;
    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        width as i32,
        height as i32,
    )?;
    let stream = InMemoryRandomAccessStream::new()?;
    let encoder = BitmapEncoder::CreateAsync(BitmapEncoder::PngEncoderId()?, &stream)?.join()?;
    encoder.SetSoftwareBitmap(&bitmap)?;
    encoder.FlushAsync()?.join()?;
    stream.Seek(0)?;
    let size = stream.Size()?;
    let length = u32::try_from(size).map_err(|_| capture_error("Screenshot is too large"))?;
    let reader = DataReader::CreateDataReader(&stream)?;
    reader.LoadAsync(length)?.join()?;
    let mut png = vec![0; length as usize];
    reader.ReadBytes(&mut png)?;
    Ok(png)
}

#[cfg(windows)]
fn capture_error(message: &str) -> windows::core::Error {
    use windows::core::{Error, HRESULT};
    Error::new(HRESULT(0x80004005u32 as i32), message)
}

#[cfg(all(test, windows))]
mod tests {
    use super::{capture_gdi, display_bounds_at};

    #[test]
    #[ignore = "requires an interactive Windows desktop"]
    fn gdi_capture_returns_png() {
        let (x, y, width, height) = display_bounds_at(0, 0).unwrap();
        let png = capture_gdi(x, y, width.min(400), height.min(200)).unwrap();
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(png.len() > 1_000);
    }
}
