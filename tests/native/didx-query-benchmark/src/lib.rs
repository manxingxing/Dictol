// Expose the core API used by the production binding included below.
pub use mdict::*;

// Compile the real Node binding into the experimental addon, so both variants use
// the same parser, compiler flags, N-API conversion and libuv implementation.
#[path = "../../../../native/mdict/src/binding.rs"]
mod production;

mod collection;
