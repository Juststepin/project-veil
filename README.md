# Project VEIL

2D Top-down Turn-based Grid Sandbox RPG (TypeScript + Vite + HTML5 Canvas).

## Live Preview (GitHub Pages)

https://juststepin.github.io/project-veil/

## Cấu trúc mã nguồn (`src/`)

- `src/data/`: Dữ liệu tĩnh JSON (thực thể, vật phẩm, cấu hình).
- `src/core/`: Bộ não game viết bằng TypeScript thuần (không phụ thuộc DOM/Canvas).
- `src/perception/`: Bộ lọc nhận thức (`PerceptionService`) chuyển đổi dữ liệu thật/giả theo chỉ số `lucidity`.
- `src/ui/`: Giao diện hiển thị HTML5 Canvas, điều khiển cảm ứng/bàn phím, Combat Log và Túi đồ.

## Chạy cục bộ

```bash
npm install
npm run dev
```

## Build production

```bash
npm run build
```
