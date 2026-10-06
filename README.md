# sha3.si

Static site for https://sha3.si: an in-browser SHA-3 calculator plus reference pages. The domain is for sale.

- `python build.py` regenerates `docs/` (all digests computed at build time).
- `python test_site.py` drives the built site in Chromium.
- Hosted on GitHub Pages from `docs/`.

Hashing by [js-sha3](https://github.com/emn178/js-sha3) (MIT, see docs/assets/js-sha3-LICENSE.txt).
