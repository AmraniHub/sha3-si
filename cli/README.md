# sha3-check

SHA-3, SHAKE and Ethereum Keccak-256 checksums from the command line, with built-in verification.

```sh
npx sha3-check file.zip                       # SHA3-256 of a file
npx sha3-check file.zip -a sha3-512           # pick the algorithm
npx sha3-check file.zip -e 3a985da74fe2...    # verify: exit 0 on match, 1 on mismatch
npx sha3-check -s "transfer(address,uint256)" -a keccak-256   # Ethereum selector: a9059cbb...
cat file | npx sha3-check - -a all            # every SHA-3 variant at once
```

## Options

| Option | Meaning |
|---|---|
| `-a, --algo` | `sha3-224`, `sha3-256` (default), `sha3-384`, `sha3-512`, `shake128`, `shake256`, `keccak-256`, `all` |
| `-l, --length` | output bits for SHAKE (default 256) |
| `-e, --expect` | expected hash; exit code 0 if it matches, 1 if not |
| `-s, --string` | hash a UTF-8 string instead of a file |
| `--json` | machine-readable output |

Files are streamed, so large downloads hash without loading into memory. SHA-3 and SHAKE come from Node's built-in `crypto` (OpenSSL); Keccak-256 from [js-sha3](https://github.com/emn178/js-sha3) (MIT), bundled.

## SHA3-256 or Keccak-256?

They are not the same. Ethereum uses the original Keccak padding (`0x01`); NIST SHA-3 (FIPS 202) uses `0x06`, so the outputs differ completely. The empty-string hash tells you which one you have:

- Keccak-256: `c5d24601...`
- SHA3-256: `a7ffc6f8...`

More: [SHA-3 vs Keccak-256](https://sha3.si/sha3-vs-keccak/).

## Online

Prefer a browser? [sha3.si](https://sha3.si) has the same functions as a private, in-browser calculator, plus test vectors and code examples in nine languages.

## License

MIT
