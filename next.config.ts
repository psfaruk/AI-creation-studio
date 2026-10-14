import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* অডিট-সমাধান: ignoreBuildErrors সরানো হলো — TypeScript-ত্রুটি এখন আর
     নীরবে বিল্ডে ঢুকবে না (CI-গেট; `bun run typecheck` দিয়ে আলাদাভাবেও
     যাচাইযোগ্য)। */
  reactStrictMode: false,
};

export default nextConfig;
