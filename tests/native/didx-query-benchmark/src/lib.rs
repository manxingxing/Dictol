// Compile the real Node binding into the experimental addon, so both variants use
// the same parser, compiler flags, N-API conversion and libuv implementation.
#[path = "../../../../native/mdict-node/src/lib.rs"]
mod production;

mod collection;
