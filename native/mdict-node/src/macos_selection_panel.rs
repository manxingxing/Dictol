//! Real AppKit non-activating panels hosting Electron-owned view trees.

use std::sync::{Mutex, OnceLock};

use napi::bindgen_prelude::Buffer;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{Error, Result, Status};
use napi_derive::napi;

pub type PanelCallback = ThreadsafeFunction<String>;

#[napi(object)]
pub struct SelectionPanelBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn callbacks() -> &'static Mutex<[Option<PanelCallback>; 1]> {
    static CALLBACKS: OnceLock<Mutex<[Option<PanelCallback>; 1]>> = OnceLock::new();
    CALLBACKS.get_or_init(|| Mutex::new([None]))
}

fn slot(panel_id: u32) -> Result<usize> {
    match panel_id {
        0 => Ok(panel_id as usize),
        _ => Err(Error::new(Status::InvalidArg, "Unknown selection panel id")),
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::ffi::c_void;

    pub(super) fn native_view_pointer(handle: &Buffer) -> Result<*mut c_void> {
        let pointer_size = std::mem::size_of::<usize>();
        if handle.len() != pointer_size {
            return Err(Error::new(
                Status::InvalidArg,
                format!("Expected a {pointer_size}-byte macOS NSView handle"),
            ));
        }
        let pointer = usize::from_ne_bytes(
            handle
                .as_ref()
                .try_into()
                .map_err(|_| Error::new(Status::InvalidArg, "Invalid native window handle"))?,
        );
        if pointer == 0 {
            return Err(Error::new(
                Status::InvalidArg,
                "Native window handle is null",
            ));
        }
        Ok(pointer as *mut c_void)
    }

    unsafe extern "C" {
        fn dictol_configure_electron_panel(view: *mut c_void) -> i32;
        fn dictol_panel_create(
            panel_id: i32,
            view: *mut c_void,
            resizable: bool,
            movable: bool,
            notify: extern "C" fn(i32, i32),
        ) -> i32;
        fn dictol_panel_destroy(panel_id: i32) -> i32;
        fn dictol_panel_show(panel_id: i32, focus: bool) -> i32;
        fn dictol_panel_hide(panel_id: i32) -> i32;
        fn dictol_panel_show_disable_menu(panel_id: i32, enabled: bool) -> i32;
        fn dictol_panel_state(panel_id: i32) -> u32;
        fn dictol_panel_bounds(panel_id: i32, values: *mut f64) -> i32;
        fn dictol_panel_set_bounds(panel_id: i32, x: f64, y: f64, width: f64, height: f64) -> i32;
    }

    pub(super) extern "C" fn notify(panel_id: i32, event_id: i32) {
        // AppKit emits numeric events on the main thread; forward only events
        // belonging to a live panel to its JavaScript callback.
        let event = match event_id {
            1 => "show",
            2 => "hide",
            3 => "resize",
            4 => "move",
            5 => "focus",
            6 => "blur",
            7 => "resize-end",
            8 => "disable-selection",
            _ => return,
        };
        let Ok(index) = usize::try_from(panel_id) else {
            return;
        };
        let Ok(callbacks) = super::callbacks().lock() else {
            return;
        };
        let Some(Some(callback)) = callbacks.get(index) else {
            return;
        };
        callback.call(
            Ok(event.to_owned()),
            ThreadsafeFunctionCallMode::NonBlocking,
        );
    }

    pub(super) fn create(
        panel_id: usize,
        view: *mut c_void,
        resizable: bool,
        movable: bool,
    ) -> Result<()> {
        let result =
            unsafe { dictol_panel_create(panel_id as i32, view, resizable, movable, notify) };
        if result == 1 {
            Ok(())
        } else {
            Err(Error::new(
                Status::GenericFailure,
                format!("AppKit could not create selection panel (status {result})"),
            ))
        }
    }

    pub(super) fn configure_electron_panel(view: *mut c_void) -> Result<()> {
        check(
            unsafe { dictol_configure_electron_panel(view) },
            "configure Electron panel window",
        )
    }

    pub(super) fn destroy(panel_id: usize) -> Result<()> {
        check(unsafe { dictol_panel_destroy(panel_id as i32) }, "destroy")
    }

    pub(super) fn show(panel_id: usize, focus: bool) -> Result<()> {
        check(unsafe { dictol_panel_show(panel_id as i32, focus) }, "show")
    }

    pub(super) fn hide(panel_id: usize) -> Result<()> {
        check(unsafe { dictol_panel_hide(panel_id as i32) }, "hide")
    }

    pub(super) fn show_disable_menu(panel_id: usize, enabled: bool) -> Result<()> {
        check(
            unsafe { dictol_panel_show_disable_menu(panel_id as i32, enabled) },
            "show disable-selection menu",
        )
    }

    pub(super) fn state(panel_id: usize) -> u32 {
        unsafe { dictol_panel_state(panel_id as i32) }
    }

    pub(super) fn bounds(panel_id: usize) -> Result<SelectionPanelBounds> {
        let mut values = [0.0; 4];
        check(
            unsafe { dictol_panel_bounds(panel_id as i32, values.as_mut_ptr()) },
            "read bounds",
        )?;
        Ok(SelectionPanelBounds {
            x: values[0],
            y: values[1],
            width: values[2],
            height: values[3],
        })
    }

    pub(super) fn set_bounds(panel_id: usize, bounds: &SelectionPanelBounds) -> Result<()> {
        check(
            unsafe {
                dictol_panel_set_bounds(
                    panel_id as i32,
                    bounds.x,
                    bounds.y,
                    bounds.width,
                    bounds.height,
                )
            },
            "set bounds",
        )
    }

    fn check(status: i32, operation: &str) -> Result<()> {
        match status {
            1 => Ok(()),
            -1 => Err(Error::new(
                Status::GenericFailure,
                format!("AppKit {operation} must run on the main thread"),
            )),
            _ => Err(Error::new(
                Status::GenericFailure,
                format!("AppKit {operation} failed (native status {status})"),
            )),
        }
    }
}

/// Configure an Electron-managed panel window without moving its Chromium content view.
#[napi]
pub fn configure_electron_panel(native_window_handle: Buffer) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        platform::configure_electron_panel(platform::native_view_pointer(&native_window_handle)?)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = native_window_handle;
        Err(Error::new(
            Status::GenericFailure,
            "Electron panel configuration requires macOS",
        ))
    }
}

#[napi]
pub fn create_selection_panel(
    panel_id: u32,
    native_window_handle: Buffer,
    resizable: bool,
    movable: bool,
    callback: PanelCallback,
) -> Result<()> {
    let index = slot(panel_id)?;
    #[cfg(target_os = "macos")]
    {
        let pointer = platform::native_view_pointer(&native_window_handle)?;
        // Register before native creation so any AppKit event during creation
        // already has a recipient. Roll the slot back if creation fails.
        {
            let mut callbacks = callbacks().lock().map_err(|_| {
                Error::new(
                    Status::GenericFailure,
                    "Selection panel callback lock poisoned",
                )
            })?;
            if callbacks[index].is_some() {
                return Err(Error::new(
                    Status::GenericFailure,
                    "Selection panel already exists",
                ));
            }
            callbacks[index] = Some(callback);
        }
        if let Err(error) = platform::create(index, pointer, resizable, movable) {
            if let Ok(mut callbacks) = callbacks().lock() {
                callbacks[index].take();
            }
            return Err(error);
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (index, native_window_handle, resizable, movable, callback);
        Err(Error::new(
            Status::GenericFailure,
            "Native selection panels require macOS",
        ))
    }
}

#[napi]
pub fn destroy_selection_panel(panel_id: u32) -> Result<()> {
    let index = slot(panel_id)?;
    #[cfg(target_os = "macos")]
    {
        platform::destroy(index)?;
        callbacks().lock().map_err(|_| {
            Error::new(
                Status::GenericFailure,
                "Selection panel callback lock poisoned",
            )
        })?[index]
            .take();
    }
    Ok(())
}

#[napi]
pub fn show_selection_panel(panel_id: u32, focus: bool) -> Result<()> {
    let index = slot(panel_id)?;
    #[cfg(target_os = "macos")]
    platform::show(index, focus)?;
    #[cfg(not(target_os = "macos"))]
    let _ = (index, focus);
    Ok(())
}

#[napi]
pub fn hide_selection_panel(panel_id: u32) -> Result<()> {
    let index = slot(panel_id)?;
    #[cfg(target_os = "macos")]
    platform::hide(index)?;
    #[cfg(not(target_os = "macos"))]
    let _ = index;
    Ok(())
}

#[napi]
pub fn show_selection_panel_disable_menu(panel_id: u32, enabled: bool) -> Result<()> {
    let index = slot(panel_id)?;
    #[cfg(target_os = "macos")]
    platform::show_disable_menu(index, enabled)?;
    #[cfg(not(target_os = "macos"))]
    let _ = (index, enabled);
    Ok(())
}

#[napi]
pub fn selection_panel_state(panel_id: u32) -> Result<u32> {
    let index = slot(panel_id)?;
    #[cfg(target_os = "macos")]
    return Ok(platform::state(index));
    #[cfg(not(target_os = "macos"))]
    {
        let _ = index;
        Ok(0)
    }
}

#[napi]
pub fn get_selection_panel_bounds(panel_id: u32) -> Result<SelectionPanelBounds> {
    let index = slot(panel_id)?;
    #[cfg(target_os = "macos")]
    return platform::bounds(index);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = index;
        Ok(SelectionPanelBounds {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
        })
    }
}

#[napi]
pub fn set_selection_panel_bounds(panel_id: u32, bounds: SelectionPanelBounds) -> Result<()> {
    let index = slot(panel_id)?;
    #[cfg(target_os = "macos")]
    platform::set_bounds(index, &bounds)?;
    #[cfg(not(target_os = "macos"))]
    let _ = (index, bounds);
    Ok(())
}
