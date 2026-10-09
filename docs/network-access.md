# Reaching Reader from other devices

By default the server accepts connections from this PC only. There is no login, so only open it to a network you trust. To also reach it from your other devices over [Tailscale](https://tailscale.com):

```
$env:READER_TAILSCALE = "1"; npm start        # PowerShell
READER_TAILSCALE=1 npm start                  # bash, zsh
```

The server then listens on `127.0.0.1` and on this PC's Tailscale address (the IPv4 address in 100.64.0.0/10, the first one found) and prints both, for example `http://100.101.102.103:5174`. Open that address from any device on your tailnet. If Tailscale is not running, the server refuses to start and says so; it never falls back to listening on every address.

Precedence: `READER_HOST` sets the base address (default `127.0.0.1`) and `READER_TAILSCALE` adds the Tailscale address to it, so `READER_HOST=192.168.1.20 READER_TAILSCALE=1` listens on exactly those two. `READER_HOST` alone listens on that one address only. Nothing listens on `0.0.0.0` unless you set `READER_HOST=0.0.0.0` yourself.

Over Tailscale the page is plain HTTP. Reading works that way, but if you want HTTPS (a secure browser context), leave `READER_TAILSCALE` off and let Tailscale proxy the localhost server instead: `tailscale serve --bg 5174`, then open the `https://` name it prints; `tailscale serve reset` undoes it.
