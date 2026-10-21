use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    napi_build::setup();

    // Compile the AppKit window bridge with the system toolchain instead of
    // adding a crate solely for Objective-C compilation.
    let target = env::var("TARGET").unwrap_or_default();
    if !target.contains("apple-darwin") {
        return;
    }

    build_macos_bridges(&target);
}

fn build_macos_bridges(target: &str) {
    // Selection panel is the only remaining AppKit bridge in this addon.
    const SOURCES: [&str; 1] = ["src/selection_panel.m"];
    const ARCHIVE: &str = "libdictol_macos_bridges.a";

    for source in SOURCES {
        println!("cargo:rerun-if-changed={source}");
    }
    println!("cargo:rerun-if-env-changed=SDKROOT");

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is always set by cargo"));
    let objects: Vec<PathBuf> = SOURCES
        .iter()
        .map(|source| {
            out_dir.join(
                PathBuf::from(source)
                    .file_stem()
                    .expect("Objective-C source has a file name")
                    .to_string_lossy()
                    .to_string()
                    + ".o",
            )
        })
        .collect();
    let archive = out_dir.join(ARCHIVE);

    // Cross-architecture builds must compile against the requested target SDK
    // and architecture, not whichever defaults the local clang happens to use.
    let sdk = env::var("SDKROOT")
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(show_sdk_path);
    let arch = if target.starts_with("aarch64") {
        "arm64"
    } else {
        "x86_64"
    };

    // Compile each Objective-C source separately before archiving; Cargo then
    // links this archive and the Apple frameworks into the native addon.
    for (source, object) in SOURCES.iter().zip(&objects) {
        let mut compile = Command::new(env::var("CC").unwrap_or_else(|_| "clang".to_owned()));
        compile
            .arg("-c")
            .arg(source)
            .arg("-o")
            .arg(object)
            .arg("-isysroot")
            .arg(&sdk)
            .arg("-arch")
            .arg(arch)
            .arg("-fobjc-arc")
            .arg("-fblocks")
            .arg("-O2")
            .arg("-Wall");
        if let Ok(deployment_target) = env::var("MACOSX_DEPLOYMENT_TARGET") {
            if !deployment_target.is_empty() {
                compile.arg(format!("-mmacosx-version-min={deployment_target}"));
            }
        }
        run(compile, &format!("compiling {source}"));
    }

    let mut archive_command = Command::new(env::var("AR").unwrap_or_else(|_| "ar".to_owned()));
    archive_command.arg("crs").arg(&archive);
    archive_command.args(&objects);
    run(archive_command, "archiving the remaining macOS bridges");

    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!(
        "cargo:rustc-link-lib=static={}",
        ARCHIVE.trim_end_matches(".a").trim_start_matches("lib")
    );
    println!("cargo:rustc-link-lib=framework=AppKit");
    println!("cargo:rustc-link-lib=framework=ApplicationServices");
}

fn show_sdk_path() -> String {
    let output = Command::new("xcrun")
        .args(["--sdk", "macosx", "--show-sdk-path"])
        .output()
        .expect("`xcrun` is required to locate the macOS SDK");
    assert!(
        output.status.success(),
        "`xcrun --sdk macosx --show-sdk-path` failed"
    );
    String::from_utf8(output.stdout)
        .expect("xcrun produced invalid UTF-8")
        .trim()
        .to_owned()
}

fn run(mut command: Command, what: &str) {
    let rendered = format!("{command:?}");
    let status = command
        .status()
        .unwrap_or_else(|error| panic!("Failed to start `{rendered}` while {what}: {error}"));
    assert!(status.success(), "Failed while {what}: `{rendered}`");
}
