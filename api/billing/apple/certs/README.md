# Apple root certificate

Drop Apple's root CA here so the server can verify the
signature chain on StoreKit 2 transactions and App Store
Server notifications.

## What to place here

Download **Apple Root CA - G3** (`AppleRootCA-G3.cer`) from
Apple's certificate authority page:

    https://www.apple.com/certificateauthority/

Save it into this directory (or set `APPLE_ROOT_CA_PATH` to a
different directory). Both DER (`.cer`, `.der`) and PEM
(`.pem`, `.crt`) encodings are accepted; every matching file
in the directory is loaded as a trusted root.

## Notes

- This is Apple's **App Store** PKI root, used to trust
  transactions Apple signs. It is unrelated to the Developer
  ID code-signing certificates used to notarize the desktop
  app.
- The certificate is public, but it is treated like a
  provisioned secret and kept out of git (see `.gitignore`
  in this directory) so the trust anchor is set explicitly
  per deployment rather than shipped in source.
- Without a root certificate here, `POST /billing/apple/verify`
  and the notification webhook return `503` instead of
  trusting anything.
