// VGS Marketing Agency — site HTML generator.
//
// We don't call an LLM here. A small parameterized template renders a
// believable marketing landing page from a brief. The agent calling
// create_marketing_site does the creative work in its own response
// (writing the brief / picking the tagline / choosing features); the
// MCP server just turns those into a real, publishable page.

const STYLES = {
  modern: {
    bg: "from-indigo-50 via-white to-purple-50",
    accent: "from-indigo-600 to-purple-600",
    button: "bg-indigo-600 hover:bg-indigo-700",
    heroSeed: "modern",
  },
  playful: {
    bg: "from-rose-50 via-white to-amber-50",
    accent: "from-rose-500 to-amber-500",
    button: "bg-rose-500 hover:bg-rose-600",
    heroSeed: "playful",
  },
  corporate: {
    bg: "from-slate-50 via-white to-blue-50",
    accent: "from-slate-700 to-blue-700",
    button: "bg-blue-700 hover:bg-blue-800",
    heroSeed: "corporate",
  },
  bold: {
    bg: "from-zinc-900 via-zinc-900 to-black",
    accent: "from-emerald-400 to-lime-400",
    button: "bg-emerald-500 hover:bg-emerald-400",
    heroSeed: "bold",
    dark: true,
  },
};

const DEFAULT_FEATURES = [
  { icon: "⚡", title: "Lightning fast", body: "Optimised pages that load in under a second on any device." },
  { icon: "🛡️", title: "Built to scale", body: "Battle-tested infrastructure that grows with your audience." },
  { icon: "✨", title: "Beautifully crafted", body: "Hand-picked typography and palettes that fit your brand." },
];

export function renderMarketingSite({
  siteId,
  companyName,
  tagline,
  brief,
  style = "modern",
  features,
  ctaPrimary = "Get started",
  ctaSecondary = "Learn more",
}) {
  const palette = STYLES[style] ?? STYLES.modern;
  const safeName = escapeHtml(companyName || "Untitled");
  const safeTagline = escapeHtml(tagline || brief || "A new chapter is about to begin.");
  const safeBrief = escapeHtml(brief || "");
  const featureCards = (features?.length ? features : DEFAULT_FEATURES)
    .slice(0, 3)
    .map((f) => featureCard(f, palette))
    .join("\n");
  const heroImageUrl = `https://picsum.photos/seed/${encodeURIComponent(palette.heroSeed + "-" + siteId)}/1600/900`;

  const textColor = palette.dark ? "text-zinc-100" : "text-gray-900";
  const mutedColor = palette.dark ? "text-zinc-400" : "text-gray-600";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeName}</title>
  <meta name="description" content="${safeTagline}">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&display=swap" rel="stylesheet">
  <style> body { font-family: 'Inter', system-ui, sans-serif; } </style>
</head>
<body class="bg-gradient-to-br ${palette.bg} min-h-screen ${textColor}">
  <header class="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
    <div class="font-semibold tracking-tight">${safeName}</div>
    <nav class="flex gap-6 text-sm ${mutedColor}">
      <a href="#features" class="hover:opacity-80">Features</a>
      <a href="#cta" class="hover:opacity-80">Pricing</a>
      <a href="#cta" class="hover:opacity-80">Contact</a>
    </nav>
  </header>

  <section class="max-w-6xl mx-auto px-6 pt-16 pb-24 grid md:grid-cols-2 gap-12 items-center">
    <div>
      <span class="inline-block px-3 py-1 text-xs font-medium rounded-full bg-white/60 backdrop-blur ${palette.dark ? "text-zinc-200 border border-zinc-700" : "text-gray-700 border border-gray-200"}">
        New launch
      </span>
      <h1 class="mt-6 text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.05]">
        <span class="bg-clip-text text-transparent bg-gradient-to-r ${palette.accent}">${safeName}</span>
      </h1>
      <p class="mt-6 text-xl ${mutedColor} max-w-xl leading-relaxed">${safeTagline}</p>
      ${safeBrief && safeBrief !== safeTagline ? `<p class="mt-4 ${mutedColor} text-base max-w-xl">${safeBrief}</p>` : ""}
      <div id="cta" class="mt-10 flex gap-4">
        <a href="#" class="${palette.button} text-white font-medium px-6 py-3 rounded-lg shadow-sm">${escapeHtml(ctaPrimary)}</a>
        <a href="#" class="border ${palette.dark ? "border-zinc-700 hover:bg-zinc-800" : "border-gray-300 hover:bg-white"} px-6 py-3 rounded-lg">${escapeHtml(ctaSecondary)}</a>
      </div>
    </div>
    <div class="relative">
      <div class="aspect-[4/3] rounded-2xl overflow-hidden shadow-2xl ${palette.dark ? "ring-1 ring-zinc-800" : "ring-1 ring-gray-200"}">
        <img src="${heroImageUrl}" alt="" class="w-full h-full object-cover" loading="eager">
      </div>
    </div>
  </section>

  <section id="features" class="max-w-6xl mx-auto px-6 py-16 grid md:grid-cols-3 gap-6">
    ${featureCards}
  </section>

  <footer class="max-w-6xl mx-auto px-6 py-12 border-t ${palette.dark ? "border-zinc-800 text-zinc-500" : "border-gray-200 text-gray-500"} text-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
    <div>© ${new Date().getFullYear()} ${safeName}. All rights reserved.</div>
    <div class="opacity-70">
      Hosted by <span class="font-medium">VGS Marketing Agency</span> · site <code>${siteId}</code>
    </div>
  </footer>
</body>
</html>`;
}

function featureCard(feature, palette) {
  const cardBg = palette.dark ? "bg-zinc-900/60 ring-1 ring-zinc-800" : "bg-white shadow-sm ring-1 ring-gray-100";
  const titleColor = palette.dark ? "text-zinc-100" : "text-gray-900";
  const bodyColor = palette.dark ? "text-zinc-400" : "text-gray-600";
  return `<div class="${cardBg} rounded-xl p-6">
      <div class="text-3xl">${escapeHtml(feature.icon ?? "✨")}</div>
      <h3 class="mt-4 font-semibold text-lg ${titleColor}">${escapeHtml(feature.title ?? "Feature")}</h3>
      <p class="mt-2 ${bodyColor} text-sm leading-relaxed">${escapeHtml(feature.body ?? "")}</p>
    </div>`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
