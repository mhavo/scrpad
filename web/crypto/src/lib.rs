//! The app's `src/crypto.rs` for the browser, as plain wasm exports (no wasm-bindgen).
//!
//! JS writes the password and the text into buffers from `alloc`, calls `encrypt` or `decrypt`
//! and reads the answer from `out_ptr`/`out_len`. The return value is 0 on success, else the
//! error: 1 not an encrypted message, 2 wrong password or corrupted, 3 empty password.

#![no_main]

#[path = "../../../src/crypto.rs"]
mod crypto;

use std::cell::RefCell;

use zeroize::Zeroize;

thread_local! {
    static OUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

#[link(wasm_import_module = "env")]
unsafe extern "C" {
    /// `crypto.getRandomValues` over `len` bytes of this module's memory at `ptr`.
    fn random_fill(ptr: *mut u8, len: usize);
}

/// The getrandom custom backend (`.cargo/config.toml`).
///
/// # Safety
/// getrandom passes a writable buffer of `len` bytes.
#[unsafe(no_mangle)]
unsafe extern "Rust" fn __getrandom_v03_custom(dest: *mut u8, len: usize) -> Result<(), getrandom::Error> {
    // SAFETY: the JS side writes exactly `len` bytes at `dest`, inside this module's memory.
    unsafe { random_fill(dest, len) };
    Ok(())
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len.max(1));
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Wipes and frees a buffer from `alloc`.
///
/// # Safety
/// `ptr` and `len` come from one `alloc(len)` call, freed once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    // SAFETY: the caller hands back a buffer of this capacity from `alloc`.
    let mut buf = unsafe { Vec::from_raw_parts(ptr, len, len.max(1)) };
    buf.zeroize();
}

#[unsafe(no_mangle)]
pub extern "C" fn out_ptr() -> *const u8 {
    OUT.with_borrow(|out| out.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn out_len() -> usize {
    OUT.with_borrow(|out| out.len())
}

/// Wipes the last answer once JS has read it.
#[unsafe(no_mangle)]
pub extern "C" fn out_clear() {
    OUT.with_borrow_mut(|out| out.zeroize());
}

/// # Safety
/// Both pointers come from `alloc` and hold the given number of bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn encrypt(password: *const u8, password_len: usize, text: *const u8, text_len: usize) -> u32 {
    // SAFETY: see the function's contract.
    let (password, text) = unsafe { (utf8(password, password_len), utf8(text, text_len)) };
    let (Some(password), Some(text)) = (password, text) else { return 1 };
    answer(crypto::encrypt(password, text))
}

/// # Safety
/// Both pointers come from `alloc` and hold the given number of bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn decrypt(password: *const u8, password_len: usize, message: *const u8, message_len: usize) -> u32 {
    // SAFETY: see the function's contract.
    let (password, message) = unsafe { (utf8(password, password_len), utf8(message, message_len)) };
    let (Some(password), Some(message)) = (password, message) else { return 1 };
    answer(crypto::decrypt(password, message))
}

/// # Safety
/// `ptr` holds `len` readable bytes that outlive the returned borrow.
unsafe fn utf8<'a>(ptr: *const u8, len: usize) -> Option<&'a str> {
    // SAFETY: see the function's contract.
    std::str::from_utf8(unsafe { std::slice::from_raw_parts(ptr, len) }).ok()
}

fn answer(result: Result<String, crypto::Error>) -> u32 {
    match result {
        Ok(text) => {
            OUT.with_borrow_mut(|out| {
                out.zeroize();
                *out = text.into_bytes();
            });
            0
        }
        Err(crypto::Error::InvalidFormat) => 1,
        Err(crypto::Error::DecryptFailed) => 2,
        Err(crypto::Error::EmptyPassword) => 3,
    }
}
