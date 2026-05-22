// Vellum — site HTML renderer (template-based).
//
// The LLM never writes raw HTML. It produces a small JSON `params` object;
// renderMarketingSite() substitutes those values into a fixed, hand-tuned
// landing-page template (modelled on the strawberry-farm reference site).
//
// Everything visual (Tailwind classes, gradients, animations, scripts) is
// fixed here. Only content, theme color, and image seeds vary per site.

const THEME_COLORS = new Set([
  "rose", "amber", "emerald", "sky", "violet", "fuchsia", "teal", "indigo", "lime", "orange",
]);

const DEFAULTS = {
  language: "en",
  themeColor: "rose",
  brand: { emoji: "✨", name: "Brand" },
  hero: {
    badge: "New",
    headlineLines: ["Made", "with care", "for you"],
    tagline: "A new product created specifically for your needs.",
    primaryCta: "Learn more",
    secondaryCta: "View details",
    usps: ["High quality", "Fast delivery", "Reliable service"],
  },
  stats: [
    { value: "100%", label: "Quality" },
    { value: "24/7", label: "Support" },
    { value: "500+", label: "Clients" },
    { value: "5 ★", label: "Rating" },
  ],
  about: {
    eyebrow: "About us",
    headlineLines: ["We build what", "we believe in"],
    paragraphs: [
      "Our team works to make sure every client gets the best possible result.",
      "Every day we aim to improve, and that care shows in our work.",
    ],
    miniCards: [
      { icon: "✨", title: "Quality", subtitle: "In every detail" },
      { icon: "💎", title: "Reliability", subtitle: "Proven over time" },
    ],
  },
  why: {
    eyebrow: "Why us?",
    headline: "The difference is our approach",
    features: [
      { icon: "⚡", title: "Speed", body: "We move quickly without compromising quality." },
      { icon: "🛡️", title: "Security", body: "Your data stays protected." },
      { icon: "🎯", title: "Precision", body: "No compromises in the final result." },
      { icon: "💰", title: "Fair pricing", body: "Pay only for what you receive." },
      { icon: "🎁", title: "Bonuses", body: "Loyal clients get more." },
      { icon: "❤️", title: "Customer care", body: "We are always available and ready to help." },
    ],
  },
  prices: {
    eyebrow: "Our plans",
    headline: "Choose the right plan",
    subtitle: "Clear pricing with no hidden fees",
    popularBadge: "POPULAR",
    tiers: [
      {
        icon: "🌱", name: "Start", subtitle: "For trying it out",
        price: "$19", unit: "/mo",
        bullets: ["Basic features", "Email support", "Up to 5 projects"],
        cta: "Choose",
      },
      {
        icon: "🚀", name: "Pro", subtitle: "Most popular",
        price: "$49", unit: "/mo",
        bullets: ["Everything in Start", "Priority support", "Unlimited projects", "Advanced analytics"],
        cta: "Choose",
      },
      {
        icon: "💎", name: "Business", subtitle: "For teams",
        price: "$149", unit: "/mo",
        bullets: ["Everything in Pro", "Dedicated manager", "API access", "Custom setup"],
        cta: "Contact us",
      },
    ],
  },
  reviews: {
    eyebrow: "Reviews",
    headline: "What clients say",
    items: [
      { text: "Excellent service. I recommend it to everyone!", initial: "M", name: "Maria K.", city: "New York" },
      { text: "The quality is excellent, and support replies quickly.", initial: "A", name: "Andrew P.", city: "Chicago" },
      { text: "I have used it for a year and it has never let me down.", initial: "E", name: "Elena S.", city: "Austin" },
    ],
  },
  order: {
    eyebrow: "Contact us",
    headlineLines: ["Ready to start?", "Send a request"],
    subtitle: "We will call back within 30 minutes",
    nameLabel: "Your name",
    namePlaceholder: "Alex Johnson",
    phoneLabel: "Phone",
    phonePlaceholder: "+1 (555) 000-0000",
    quantityLabel: "What are you interested in?",
    quantities: ["Starter plan", "Professional", "Business", "Consultation", "Other"],
    addressLabel: "Address",
    addressPlaceholder: "City, street, building",
    timeLabel: "Preferred time",
    times: ["Morning (9:00-12:00)", "Afternoon (12:00-17:00)", "Evening (17:00-21:00)"],
    commentLabel: "Comment",
    commentPlaceholder: "Additional details...",
    submitCta: "Send request ->",
    consent: "By clicking the button, you agree to the processing of personal data",
  },
  footer: {
    tagline: "Creating better results for our clients every day.",
    contactsHeading: "Contacts",
    phone: "+1 (555) 123-4567",
    email: "hello@example.com",
    location: "United States",
    navigationHeading: "Navigation",
    navAbout: "About",
    navWhy: "Benefits",
    navPrices: "Pricing",
    navOrder: "Contact",
    socialHeading: "Social media",
    copyright: `© ${new Date().getFullYear()} Brand`,
  },
  imageSeeds: {
    hero: "brand-hero",
    about: "brand-about",
  },
};

export function renderMarketingSite(params = {}) {
  const p = mergeDeep(DEFAULTS, params);
  const c = THEME_COLORS.has(p.themeColor) ? p.themeColor : "rose";
  const e = escapeHtml;

  const heroLines = (p.hero.headlineLines ?? []).slice(0, 3);
  while (heroLines.length < 3) heroLines.push("");
  const aboutLines = (p.about.headlineLines ?? []).slice(0, 2);
  while (aboutLines.length < 2) aboutLines.push("");
  const orderLines = (p.order.headlineLines ?? []).slice(0, 2);
  while (orderLines.length < 2) orderLines.push("");

  const stats = (p.stats ?? []).slice(0, 4);
  while (stats.length < 4) stats.push({ value: "—", label: "" });

  const miniCards = (p.about.miniCards ?? []).slice(0, 2);
  while (miniCards.length < 2) miniCards.push({ icon: "✨", title: "", subtitle: "" });

  const features = (p.why.features ?? []).slice(0, 6);
  while (features.length < 6) features.push({ icon: "✨", title: "", body: "" });
  const featureAccents = ["rose", "emerald", "sky", "amber", "violet", "fuchsia"];

  const tiers = (p.prices.tiers ?? []).slice(0, 3);
  while (tiers.length < 3) tiers.push({ icon: "•", name: "", subtitle: "", price: "—", unit: "", bullets: [], cta: "" });

  const reviews = (p.reviews.items ?? []).slice(0, 3);
  while (reviews.length < 3) reviews.push({ text: "", initial: "•", name: "", city: "" });
  const reviewAccents = ["rose", "sky", "emerald"];

  const usps = (p.hero.usps ?? []).slice(0, 3);
  while (usps.length < 3) usps.push("");

  return `<!doctype html>
<html lang="${e(p.language)}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${e(p.brand.name)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <style>
    body { font-family: 'Inter', sans-serif; }
    @keyframes float { 0%,100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-14px) rotate(2deg); } }
    .float { animation: float 4s ease-in-out infinite; }
    .card { transition: transform 0.25s ease, box-shadow 0.25s ease; }
    .card:hover { transform: translateY(-6px); box-shadow: 0 24px 48px rgba(0,0,0,0.10); }
    html { scroll-behavior: smooth; }
  </style>
</head>
<body class="bg-white text-gray-800 antialiased">

  <nav class="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur-md border-b border-${c}-100">
    <div class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
      <a href="#" class="flex items-center gap-2">
        <span class="text-3xl leading-none">${e(p.brand.emoji)}</span>
        <span class="text-lg font-extrabold text-${c}-700 tracking-tight">${e(p.brand.name)}</span>
      </a>
      <div class="hidden md:flex items-center gap-7 text-sm font-medium text-gray-500">
        <a href="#about"   class="hover:text-${c}-600 transition-colors">${e(p.footer.navAbout)}</a>
        <a href="#why"     class="hover:text-${c}-600 transition-colors">${e(p.footer.navWhy)}</a>
        <a href="#prices"  class="hover:text-${c}-600 transition-colors">${e(p.footer.navPrices)}</a>
        <a href="#order"   class="hover:text-${c}-600 transition-colors">${e(p.footer.navOrder)}</a>
      </div>
      <a href="#order" class="bg-${c}-600 hover:bg-${c}-700 text-white font-semibold text-sm px-5 py-2.5 rounded-full shadow transition-colors">
        ${e(p.hero.primaryCta)} →
      </a>
    </div>
  </nav>

  <section class="bg-gradient-to-br from-${c}-50 via-white to-${c}-200 pt-28 pb-24 px-6 overflow-hidden">
    <div class="max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-14">
      <div class="flex-1 text-center md:text-left">
        <div class="inline-flex items-center gap-2 bg-${c}-100 text-${c}-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-6">
          ${e(p.hero.badge)}
        </div>
        <h1 class="text-5xl md:text-6xl font-black text-gray-900 leading-[1.08] mb-6">
          ${e(heroLines[0])}<br/>
          <span class="text-${c}-600">${e(heroLines[1])}</span><br/>
          ${e(heroLines[2])}
        </h1>
        <p class="text-xl text-gray-500 leading-relaxed mb-8 max-w-md">${e(p.hero.tagline)}</p>
        <div class="flex flex-wrap gap-4 justify-center md:justify-start mb-10">
          <a href="#order" class="bg-${c}-600 hover:bg-${c}-700 text-white font-bold px-8 py-4 rounded-full text-lg shadow-lg transition-colors">
            ${e(p.hero.primaryCta)}
          </a>
          <a href="#prices" class="border-2 border-${c}-300 hover:border-${c}-500 text-${c}-700 font-bold px-8 py-4 rounded-full text-lg transition-colors">
            ${e(p.hero.secondaryCta)}
          </a>
        </div>
        <div class="flex flex-wrap gap-5 justify-center md:justify-start text-sm font-medium text-gray-600">
          ${usps.map((u) => `<span class="flex items-center gap-1.5"><span class="text-green-500 text-base">✓</span> ${e(u)}</span>`).join("\n          ")}
        </div>
      </div>
      <div class="flex-1 flex justify-center">
        <div class="relative">
          <div class="absolute inset-0 bg-${c}-300 rounded-full blur-3xl opacity-25 scale-125"></div>
          <img src="https://picsum.photos/seed/${e(p.imageSeeds.hero)}/600/600"
               alt="${e(p.brand.name)}"
               class="relative w-72 h-72 md:w-[420px] md:h-[420px] object-cover rounded-full shadow-2xl border-8 border-white float" />
        </div>
      </div>
    </div>
  </section>

  <section class="bg-${c}-600 py-10 px-6">
    <div class="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 text-center text-white">
      ${stats.map((s) => `<div><p class="text-4xl font-black">${e(s.value)}</p><p class="text-${c}-200 text-sm mt-1">${e(s.label)}</p></div>`).join("\n      ")}
    </div>
  </section>

  <section id="about" class="py-24 px-6 bg-white">
    <div class="max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-16">
      <div class="flex-1">
        <img src="https://picsum.photos/seed/${e(p.imageSeeds.about)}/700/500" alt="${e(p.about.eyebrow)}" class="rounded-3xl shadow-xl w-full object-cover" />
      </div>
      <div class="flex-1">
        <span class="text-${c}-600 font-semibold text-xs uppercase tracking-widest">${e(p.about.eyebrow)}</span>
        <h2 class="text-4xl font-black mt-3 mb-6 text-gray-900 leading-tight">${e(aboutLines[0])}<br/>${e(aboutLines[1])}</h2>
        ${(p.about.paragraphs ?? []).map((par) => `<p class="text-gray-500 text-lg mb-5 leading-relaxed">${e(par)}</p>`).join("\n        ")}
        <div class="grid grid-cols-2 gap-4 mt-2">
          ${miniCards.map((m) => `<div class="bg-${c}-50 p-5 rounded-2xl">
            <div class="text-2xl mb-2">${e(m.icon)}</div>
            <div class="font-bold text-gray-800">${e(m.title)}</div>
            <div class="text-sm text-gray-400 mt-1">${e(m.subtitle)}</div>
          </div>`).join("\n          ")}
        </div>
      </div>
    </div>
  </section>

  <section id="why" class="py-24 px-6 bg-gradient-to-b from-white to-${c}-50">
    <div class="max-w-6xl mx-auto">
      <div class="text-center mb-16">
        <span class="text-${c}-600 font-semibold text-xs uppercase tracking-widest">${e(p.why.eyebrow)}</span>
        <h2 class="text-4xl font-black mt-3 text-gray-900">${e(p.why.headline)}</h2>
      </div>
      <div class="grid md:grid-cols-3 gap-8">
        ${features.map((f, i) => {
          const accent = featureAccents[i % featureAccents.length];
          return `<div class="bg-white p-8 rounded-3xl shadow-sm card">
          <div class="w-14 h-14 bg-${accent}-100 rounded-2xl flex items-center justify-center text-3xl mb-6">${e(f.icon)}</div>
          <h3 class="text-xl font-bold mb-3">${e(f.title)}</h3>
          <p class="text-gray-500 leading-relaxed">${e(f.body)}</p>
        </div>`;
        }).join("\n        ")}
      </div>
    </div>
  </section>

  <section id="prices" class="py-24 px-6 bg-white">
    <div class="max-w-5xl mx-auto">
      <div class="text-center mb-16">
        <span class="text-${c}-600 font-semibold text-xs uppercase tracking-widest">${e(p.prices.eyebrow)}</span>
        <h2 class="text-4xl font-black mt-3 text-gray-900">${e(p.prices.headline)}</h2>
        <p class="text-gray-400 mt-3 text-lg">${e(p.prices.subtitle)}</p>
      </div>
      <div class="grid md:grid-cols-3 gap-8 items-stretch">
        ${tiers.map((t, i) => {
          const highlighted = i === 1;
          if (highlighted) {
            return `<div class="bg-${c}-600 rounded-3xl p-8 flex flex-col text-white relative overflow-hidden card">
          <div class="absolute top-5 right-5 bg-yellow-400 text-yellow-900 text-xs font-bold px-3 py-1 rounded-full">${e(p.prices.popularBadge)}</div>
          <div class="text-4xl mb-4">${e(t.icon)}</div>
          <h3 class="text-xl font-bold">${e(t.name)}</h3>
          <p class="text-${c}-200 text-sm mt-1 mb-6">${e(t.subtitle)}</p>
          <div class="flex items-end gap-1 mb-6">
            <span class="text-4xl font-black">${e(t.price)}</span>
            <span class="text-${c}-200 mb-1.5 text-sm">${e(t.unit)}</span>
          </div>
          <ul class="space-y-3 mb-8 flex-1">
            ${(t.bullets ?? []).map((b) => `<li class="flex items-center gap-2 text-${c}-100 text-sm"><span class="text-yellow-300">✓</span> ${e(b)}</li>`).join("\n            ")}
          </ul>
          <a href="#order" class="block text-center bg-white text-${c}-700 font-semibold py-3 rounded-full hover:bg-${c}-50 transition-colors text-sm">${e(t.cta)}</a>
        </div>`;
          }
          return `<div class="border-2 border-gray-100 rounded-3xl p-8 flex flex-col card">
          <div class="text-4xl mb-4">${e(t.icon)}</div>
          <h3 class="text-xl font-bold text-gray-900">${e(t.name)}</h3>
          <p class="text-gray-400 text-sm mt-1 mb-6">${e(t.subtitle)}</p>
          <div class="flex items-end gap-1 mb-6">
            <span class="text-4xl font-black text-gray-900">${e(t.price)}</span>
            <span class="text-gray-400 mb-1.5 text-sm">${e(t.unit)}</span>
          </div>
          <ul class="space-y-3 mb-8 flex-1">
            ${(t.bullets ?? []).map((b) => `<li class="flex items-center gap-2 text-gray-600 text-sm"><span class="text-green-500">✓</span> ${e(b)}</li>`).join("\n            ")}
          </ul>
          <a href="#order" class="block text-center border-2 border-${c}-300 text-${c}-700 font-semibold py-3 rounded-full hover:bg-${c}-50 transition-colors text-sm">${e(t.cta)}</a>
        </div>`;
        }).join("\n        ")}
      </div>
    </div>
  </section>

  <section id="reviews" class="py-24 px-6 bg-${c}-50">
    <div class="max-w-5xl mx-auto">
      <div class="text-center mb-16">
        <span class="text-${c}-600 font-semibold text-xs uppercase tracking-widest">${e(p.reviews.eyebrow)}</span>
        <h2 class="text-4xl font-black mt-3 text-gray-900">${e(p.reviews.headline)}</h2>
      </div>
      <div class="grid md:grid-cols-3 gap-8">
        ${reviews.map((r, i) => {
          const accent = reviewAccents[i % reviewAccents.length];
          return `<div class="bg-white p-6 rounded-2xl shadow-sm">
          <div class="text-yellow-400 text-lg mb-3 tracking-wide">★★★★★</div>
          <p class="text-gray-500 italic mb-5 leading-relaxed text-sm">"${e(r.text)}"</p>
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-${accent}-200 rounded-full flex items-center justify-center text-${accent}-700 font-bold text-sm">${e(r.initial)}</div>
            <div><div class="font-semibold text-gray-800 text-sm">${e(r.name)}</div><div class="text-xs text-gray-400">${e(r.city)}</div></div>
          </div>
        </div>`;
        }).join("\n        ")}
      </div>
    </div>
  </section>

  <section id="order" class="py-24 px-6 bg-white">
    <div class="max-w-2xl mx-auto">
      <div class="text-center mb-12">
        <span class="text-${c}-600 font-semibold text-xs uppercase tracking-widest">${e(p.order.eyebrow)}</span>
        <h2 class="text-4xl font-black mt-3 text-gray-900 leading-tight">${e(orderLines[0])}<br/>${e(orderLines[1])}</h2>
        <p class="text-gray-400 mt-3">${e(p.order.subtitle)}</p>
      </div>
      <form class="space-y-5 bg-${c}-50 p-8 rounded-3xl">
        <div class="grid sm:grid-cols-2 gap-5">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1.5">${e(p.order.nameLabel)}</label>
            <input type="text" placeholder="${e(p.order.namePlaceholder)}" class="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-${c}-400 bg-white text-sm" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1.5">${e(p.order.phoneLabel)}</label>
            <input type="tel" placeholder="${e(p.order.phonePlaceholder)}" class="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-${c}-400 bg-white text-sm" />
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1.5">${e(p.order.quantityLabel)}</label>
          <select class="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-${c}-400 bg-white text-sm">
            <option value="">—</option>
            ${(p.order.quantities ?? []).map((q) => `<option>${e(q)}</option>`).join("\n            ")}
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1.5">${e(p.order.addressLabel)}</label>
          <input type="text" placeholder="${e(p.order.addressPlaceholder)}" class="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-${c}-400 bg-white text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1.5">${e(p.order.timeLabel)}</label>
          <select class="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-${c}-400 bg-white text-sm">
            <option value="">—</option>
            ${(p.order.times ?? []).map((t) => `<option>${e(t)}</option>`).join("\n            ")}
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1.5">${e(p.order.commentLabel)}</label>
          <textarea rows="3" placeholder="${e(p.order.commentPlaceholder)}" class="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-${c}-400 bg-white text-sm resize-none"></textarea>
        </div>
        <button type="submit" class="w-full bg-${c}-600 hover:bg-${c}-700 text-white font-bold py-4 rounded-full text-lg shadow-lg transition-colors">
          ${e(p.order.submitCta)}
        </button>
        <p class="text-center text-xs text-gray-400">${e(p.order.consent)}</p>
      </form>
    </div>
  </section>

  <footer class="bg-gray-900 text-white py-14 px-6">
    <div class="max-w-6xl mx-auto">
      <div class="flex flex-col md:flex-row justify-between gap-10 mb-10">
        <div>
          <div class="flex items-center gap-2 mb-4"><span class="text-3xl">${e(p.brand.emoji)}</span><span class="text-lg font-extrabold">${e(p.brand.name)}</span></div>
          <p class="text-gray-400 max-w-xs text-sm leading-relaxed">${e(p.footer.tagline)}</p>
        </div>
        <div>
          <h4 class="font-semibold mb-4 text-sm">${e(p.footer.contactsHeading)}</h4>
          <div class="space-y-2 text-gray-400 text-sm">
            <p>📞 ${e(p.footer.phone)}</p>
            <p>✉️ ${e(p.footer.email)}</p>
            <p>📍 ${e(p.footer.location)}</p>
          </div>
        </div>
        <div>
          <h4 class="font-semibold mb-4 text-sm">${e(p.footer.navigationHeading)}</h4>
          <div class="space-y-2 text-gray-400 text-sm">
            <p><a href="#about" class="hover:text-white transition-colors">${e(p.footer.navAbout)}</a></p>
            <p><a href="#why" class="hover:text-white transition-colors">${e(p.footer.navWhy)}</a></p>
            <p><a href="#prices" class="hover:text-white transition-colors">${e(p.footer.navPrices)}</a></p>
            <p><a href="#order" class="hover:text-white transition-colors">${e(p.footer.navOrder)}</a></p>
          </div>
        </div>
        <div>
          <h4 class="font-semibold mb-4 text-sm">${e(p.footer.socialHeading)}</h4>
          <div class="flex gap-3">
            <a href="#" class="w-10 h-10 bg-gray-700 hover:bg-${c}-600 rounded-full flex items-center justify-center text-xs font-bold transition-colors">VK</a>
            <a href="#" class="w-10 h-10 bg-gray-700 hover:bg-${c}-600 rounded-full flex items-center justify-center text-xs font-bold transition-colors">TG</a>
            <a href="#" class="w-10 h-10 bg-gray-700 hover:bg-${c}-600 rounded-full flex items-center justify-center text-xs font-bold transition-colors">IG</a>
          </div>
        </div>
      </div>
      <div class="border-t border-gray-700 pt-6 text-center text-gray-500 text-xs">${e(p.footer.copyright)}</div>
    </div>
  </footer>

</body>
</html>`;
}

// --- Helpers ---

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function mergeDeep(base, override) {
  if (override == null || typeof override !== "object" || Array.isArray(override)) return override ?? base;
  const result = Array.isArray(base) ? [...(override ?? base)] : { ...base };
  for (const key of Object.keys(override)) {
    const b = base?.[key];
    const o = override[key];
    if (b && typeof b === "object" && !Array.isArray(b) && o && typeof o === "object" && !Array.isArray(o)) {
      result[key] = mergeDeep(b, o);
    } else if (Array.isArray(o)) {
      result[key] = o; // arrays override wholesale
    } else if (o !== undefined) {
      result[key] = o;
    }
  }
  return result;
}

export { THEME_COLORS };
