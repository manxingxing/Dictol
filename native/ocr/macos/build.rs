// 配置 Node 原生模块构建，并编译系统版本与显示器缩放查询桥接代码。
fn main() {
    napi_build::setup();
    println!("cargo:rerun-if-changed=src/os_version.m");
    cc::Build::new()
        .file("src/os_version.m")
        .file("src/ocr.m")
        .file("src/word_tokenizer.m")
        .flag("-fobjc-arc")
        .flag("-fblocks")
        .compile("dictol_screen_capture_os_version");
    println!("cargo:rerun-if-changed=src/ocr.m");
    println!("cargo:rerun-if-changed=src/word_tokenizer.m");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rustc-link-lib=framework=ImageIO");
    println!("cargo:rustc-link-lib=framework=Vision");
    println!("cargo:rustc-link-lib=framework=NaturalLanguage");
}
