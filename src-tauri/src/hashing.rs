use std::fmt;

/// Computes a deterministic SHA-256 hash of the input bytes.
/// Returns lowercase hexadecimal string.
pub fn sha256_hex(input: &[u8]) -> String {
    let digest = sha256(input);
    let mut hex = String::with_capacity(64);
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    for byte in digest {
        hex.push(DIGITS[(byte >> 4) as usize] as char);
        hex.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    hex
}

/// Computes a deterministic SHA-256 hash of the input bytes.
/// Returns 32-byte array.
pub fn sha256(input: &[u8]) -> [u8; 32] {
    const INITIAL: [u32; 8] = [
        0x6a09e667,
        0xbb67ae85,
        0x3c6ef372,
        0xa54ff53a,
        0x510e527f,
        0x9b05688c,
        0x1f83d9ab,
        0x5be0cd19,
    ];
    const ROUND_CONSTANTS: [u32; 64] = [
        0x428a2f98,
        0x71374491,
        0xb5c0fbcf,
        0xe9b5dba5,
        0x3956c25b,
        0x59f111f1,
        0x923f82a4,
        0xab1c5ed5,
        0xd807aa98,
        0x12835b01,
        0x243185be,
        0x550c7dc3,
        0x72be5d74,
        0x80deb1fe,
        0x9bdc06a7,
        0xc19bf174,
        0xe49b69c1,
        0xefbe4786,
        0x0fc19dc6,
        0x240ca1cc,
        0x2de92c6f,
        0x4a7484aa,
        0x5cb0a9dc,
        0x76f988da,
        0x983e5152,
        0xa831c66d,
        0xb00327c8,
        0xbf597fc7,
        0xc6e00bf3,
        0xd5a79147,
        0x06ca6351,
        0x14292967,
        0x27b70a85,
        0x2e1b2138,
        0x4d2c6dfc,
        0x53380d13,
        0x650a7354,
        0x766a0abb,
        0x81c2c92e,
        0x92722c85,
        0xa2bfe8a1,
        0xa81a664b,
        0xc24b8b70,
        0xc76c51a3,
        0xd192e819,
        0xd6990624,
        0xf40e3585,
        0x106aa070,
        0x19a4c116,
        0x1e376c08,
        0x2748774c,
        0x34b0bcb5,
        0x391c0cb3,
        0x4ed8aa4a,
        0x5b9cca4f,
        0x682e6ff3,
        0x748f82ee,
        0x78a5636f,
        0x84c87814,
        0x8cc70208,
        0x90befffa,
        0xa4506ceb,
        0xbef9a3f7,
        0xc67178f2,
    ];

    let mut state = INITIAL;
    let mut chunks = input.chunks_exact(64);
    for chunk in &mut chunks {
        sha256_compress(&mut state, chunk, &ROUND_CONSTANTS);
    }
    let remainder = chunks.remainder();
    let mut tail = [0_u8; 128];
    tail[..remainder.len()].copy_from_slice(remainder);
    tail[remainder.len()] = 0x80;
    let tail_length = if remainder.len() < 56 { 64 } else { 128 };
    tail[tail_length - 8..tail_length]
        .copy_from_slice(&(input.len() as u64).wrapping_mul(8).to_be_bytes());
    for chunk in tail[..tail_length].chunks_exact(64) {
        sha256_compress(&mut state, chunk, &ROUND_CONSTANTS);
    }
    let mut digest = [0_u8; 32];
    for (output, word) in digest.chunks_exact_mut(4).zip(state) {
        output.copy_from_slice(&word.to_be_bytes());
    }
    digest
}

fn sha256_compress(state: &mut [u32; 8], chunk: &[u8], constants: &[u32; 64]) {
    let mut schedule = [0_u32; 64];
    for (index, word) in chunk.chunks_exact(4).enumerate() {
        schedule[index] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
    }
    for index in 16..64 {
        let s0 = schedule[index - 15].rotate_right(7)
            ^ schedule[index - 15].rotate_right(18)
            ^ (schedule[index - 15] >> 3);
        let s1 = schedule[index - 2].rotate_right(17)
            ^ schedule[index - 2].rotate_right(19)
            ^ (schedule[index - 2] >> 10);
        schedule[index] = schedule[index - 16]
            .wrapping_add(s0)
            .wrapping_add(schedule[index - 7])
            .wrapping_add(s1);
    }
    let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = *state;
    for index in 0..64 {
        let big_s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
        let choice = (e & f) ^ ((!e) & g);
        let temp1 = h
            .wrapping_add(big_s1)
            .wrapping_add(choice)
            .wrapping_add(constants[index])
            .wrapping_add(schedule[index]);
        let big_s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
        let majority = (a & b) ^ (a & c) ^ (b & c);
        let temp2 = big_s0.wrapping_add(majority);
        h = g;
        g = f;
        f = e;
        e = d.wrapping_add(temp1);
        d = c;
        c = b;
        b = a;
        a = temp1.wrapping_add(temp2);
    }
    state[0] = state[0].wrapping_add(a);
    state[1] = state[1].wrapping_add(b);
    state[2] = state[2].wrapping_add(c);
    state[3] = state[3].wrapping_add(d);
    state[4] = state[4].wrapping_add(e);
    state[5] = state[5].wrapping_add(f);
    state[6] = state[6].wrapping_add(g);
    state[7] = state[7].wrapping_add(h);
}

/// Stable SHA-256 identifier for note content.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct ContentRevision(String);

impl ContentRevision {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ContentRevision {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl From<String> for ContentRevision {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl From<&str> for ContentRevision {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}

/// Computes a deterministic content revision from UTF-8 string content.
pub fn content_revision(content: &str) -> ContentRevision {
    ContentRevision(sha256_hex(content.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_hex_empty_string() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn sha256_hex_abc() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn sha256_hex_deterministic() {
        assert_eq!(sha256_hex(b"same"), sha256_hex(b"same"));
        assert_ne!(sha256_hex(b"same"), sha256_hex(b"changed"));
    }

    #[test]
    fn content_revision_deterministic() {
        assert_eq!(content_revision("").as_str(), sha256_hex(b""));
        assert_eq!(content_revision("abc").as_str(), sha256_hex(b"abc"));
        assert_eq!(content_revision("same"), content_revision("same"));
        assert_ne!(content_revision("same"), content_revision("changed"));
    }

    #[test]
    fn workspace_path_key_deterministic() {
        let path1 = std::path::Path::new("/notes/workspace");
        let path2 = std::path::Path::new("/notes/workspace");
        assert_eq!(
            crate::hashing::sha256_hex(path1.to_string_lossy().as_bytes()),
            crate::hashing::sha256_hex(path2.to_string_lossy().as_bytes())
        );
    }

    #[test]
    fn draft_checkpoint_filename_deterministic() {
        // Draft checkpoint filenames use window_label + note_id with length prefixes
        let window_label = "main";
        let note_id = "note1";
        let mut identity = Vec::with_capacity(window_label.len() + note_id.len() + 16);
        identity.extend_from_slice(&(window_label.len() as u64).to_be_bytes());
        identity.extend_from_slice(window_label.as_bytes());
        identity.extend_from_slice(&(note_id.len() as u64).to_be_bytes());
        identity.extend_from_slice(note_id.as_bytes());

        let hash1 = sha256_hex(&identity);
        let hash2 = sha256_hex(&identity);
        assert_eq!(hash1, hash2);
        assert_eq!(hash1.len(), 64);
    }
}