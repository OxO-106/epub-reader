# Reader on your phone

Reader runs on your PC; a phone reads from it over your own private network. On an iPhone (or Android) Reader can be added to the Home Screen, where it opens full screen like an app, and Books can be kept on the phone for reading without a connection.

## Why HTTPS, and why Tailscale

An iPhone only installs a web app, and keeps its files and Books, for a site served over HTTPS. Reader does not handle certificates itself. [Tailscale](https://tailscale.com) does: it puts your PC and phone on a private network (a *tailnet*) and can give your PC a real certificate for its tailnet name, such as `https://my-pc.tail1234.ts.net`. Nobody outside your tailnet can reach that address.

## Set it up (once)

1. Install Tailscale on the PC and on the phone, and sign in to both with the same account.
2. In the [Tailscale admin console](https://login.tailscale.com/admin/dns), under **DNS**, turn on **MagicDNS** and **HTTPS Certificates**.
3. On the PC, in a terminal, run (with Reader's port, 5174 unless you changed it in Settings):

   ```bash
   tailscale serve --bg 5174
   ```

   Tailscale now answers `https://<your-pc>.<your-tailnet>.ts.net` and passes the requests to Reader on the PC. Reader keeps listening on the PC only (`127.0.0.1`); you do not need to change who can connect in Settings. `tailscale serve status` shows it; `tailscale serve --https=443 off` undoes it.
4. In Reader's **Settings**, the section **Use Reader on your phone** shows the address and a QR code of it.

## Install it on the phone

- **iPhone:** scan the QR code with the camera (or type the address in Safari), then tap **Share**, then **Add to Home Screen**.
- **Android:** open the address in Chrome, then **Install app** in the menu.
- **A PC browser:** Chrome and Edge offer **Install** in the address bar.

Installed, Reader opens full screen in your theme's colours. It updates itself to the PC's version the next time it starts while the PC is reachable.

## Reading without a connection

- Tap the **Keep** button (the arrow) on a Book in the Library, or, in the Reader, open **Contents** and choose **Keep on this device**. In **Settings, On this device** you can keep the Book you are reading automatically, see how much space the kept Books use, and remove them.
- When the PC cannot be reached, the Library shows the Books kept on the phone, and they open as usual.
- Your Reading position and highlights are saved on the phone and sent to the PC when it is back. If you read further on another device meanwhile, the place you reached last wins.
- Adding Books, translation and the Glossary need the PC; they say so while it cannot be reached.

## When something does not work

- **The address does not open:** check that Tailscale is connected on both devices, that Reader is running on the PC, and that `tailscale serve status` lists Reader's port.
- **Settings says HTTPS Certificates are not on:** turn them on in the admin console (step 2), then wait a minute.
- **No Add to Home Screen on iPhone:** the page must be opened in Safari, and over `https://`.
- **The phone is full:** remove Books from **Settings, On this device**.
