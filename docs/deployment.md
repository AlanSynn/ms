# Deployment

The web build is fully local/offline after install.

## Build

```bash
npm ci
npm run build
npm test
```

`vite build` copies static ONNX assets from `public/onnx/` into `dist/onnx/`. The contract test asserts `dist/onnx/pose_model.onnx` exists after a production build.

## CDN policy

`index.html` must not contain CDN scripts, import maps, or external `https://` runtime URLs. Dependencies are bundled through Vite from `package.json`.
