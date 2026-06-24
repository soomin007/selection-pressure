import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

// 정적 호스팅(Vercel / Netlify / GitHub Pages) 배포 → URL 하나.
// GitHub Pages 같이 서브경로에 올릴 때만 base 를 바꾼다.
export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
