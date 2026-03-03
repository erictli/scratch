# Syntax Highlighting Demo

This note verifies that fenced code blocks are highlighted using Shiki
(github-light / github-dark themes). Switch between light and dark mode
in Settings → Appearance to see themes adapt automatically.

## TypeScript

```typescript
interface User {
  id: number;
  name: string;
  email: string;
}

async function fetchUser(id: number): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json() as Promise<User>;
}

const greet = (user: User): string =>
  `Hello, ${user.name}! Your ID is ${user.id}.`;
```

## Rust

```rust
use std::collections::HashMap;

#[derive(Debug)]
struct Cache<K, V> {
    store: HashMap<K, V>,
    capacity: usize,
}

impl<K: Eq + std::hash::Hash, V> Cache<K, V> {
    fn new(capacity: usize) -> Self {
        Cache {
            store: HashMap::new(),
            capacity,
        }
    }

    fn insert(&mut self, key: K, value: V) -> Option<V> {
        if self.store.len() >= self.capacity {
            return None;
        }
        self.store.insert(key, value)
    }
}

fn main() {
    let mut cache: Cache<&str, i32> = Cache::new(10);
    cache.insert("answer", 42);
    println!("{:?}", cache);
}
```

## JavaScript

```javascript
const debounce = (fn, delay) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};
```

## JSON

```json
{
  "name": "scratch",
  "version": "0.7.1",
  "features": ["syntax-highlighting", "offline-first"]
}
```

## Bash

```bash
#!/usr/bin/env bash
set -euo pipefail

for file in *.md; do
  echo "Processing: $file"
  wc -l "$file"
done
```
