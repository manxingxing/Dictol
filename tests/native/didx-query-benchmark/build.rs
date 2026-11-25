mod production {
    include!("../../../native/mdict-node/build.rs");

    pub fn build() {
        main();
    }
}

fn main() {
    println!(
        "cargo:rerun-if-changed={}/../../../native/mdict-node/src/selection_panel.m",
        env!("CARGO_MANIFEST_DIR")
    );
    // Reuse the production bridge build on macOS, with its original relative paths.
    std::env::set_current_dir(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../native/mdict-node"
    ))
    .unwrap();
    production::build();
}
