# Clipboard Image

Attaches clipboard images to Pi prompts on WSL. Press `Alt+V` to capture the current clipboard image. The image is converted to PNG regardless of source format, resized if larger than 2000px, and queued for attachment. A numbered `[paste image #N]` marker appears in the editor to track each pending attachment; markers and images are sent inline with your message when you submit.

## How It Works

1. Press `Alt+V`. The extension reads the Wayland clipboard via `wl-paste` and pipes the image through ImageMagick for format conversion and resize.
2. A numbered `[paste image #1]` marker is inserted into the editor. Type your message around it.
3. On send, images whose markers are still present are attached to the message. The markers remain visible in the rendered prompt.

### Multiple Images

Each paste adds a new numbered marker (`[paste image #1]`, `[paste image #2]`, etc.) and queues an additional image. All images whose markers are present are attached when you send.

### Cancelling

Remove a marker from the editor before sending to skip that specific image. Each marker is tied to the image it was created for, so you can selectively remove any of them regardless of order. If all markers are removed, all pending images are discarded.

## Requirements

| Dependency | Package        | Purpose                                                               |
| ---------- | -------------- | --------------------------------------------------------------------- |
| `wl-paste` | `wl-clipboard` | Reads image data from the Wayland clipboard and lists available types |
| `convert`  | `imagemagick`  | Converts any image format to PNG and resizes to fit within 2000px     |

Requires WSLg (included by default in WSL 2 on Windows 11) for Wayland clipboard access. Both packages are available as standard system packages.

## Credits

Inspired by [guwidoe/pi-clipboard-image](https://github.com/guwidoe/pi-toolbox/tree/main/packages/clipboard-image) and [MasuRii/pi-image-tools](https://github.com/MasuRii/pi-image-tools).
