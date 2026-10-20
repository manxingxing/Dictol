fn main() {
    napi_build::setup();
    println!("cargo:rerun-if-changed=src/os_version.m");
    cc::Build::new()
        .file("src/os_version.m")
        .flag("-fobjc-arc")
        .compile("dictol_screen_capture_os_version");
    println!("cargo:rustc-link-lib=framework=Foundation");
}
