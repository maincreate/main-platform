"use strict";
const maincreateAppearance = (() => {
  const key = "maincreate-appearance";
  const presets = {
    "cool-mist": "Cool Mist",
    graphite: "Graphite + Iris",
    paper: "Warm Paper",
    midnight: "Midnight",
  };
  const defaults = { mode: "light", light: "cool-mist", dark: "midnight", templates: [] };
  const colors = ["bg", "surface", "text", "accent"];
  const modes = ["light", "dark", "system"];
  const device = matchMedia("(prefers-color-scheme: dark)");
  const isColor = value => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

  function read() {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (saved) {
        const templates = Array.isArray(saved.templates) ? saved.templates.filter(template =>
          template && /^custom-[0-9a-f-]+$/.test(template.id) && typeof template.name === "string" &&
          colors.every(color => isColor(template[color]))) : [];
        const exists = id => Object.hasOwn(presets, id) || templates.some(template => template.id === id);
        return {
          mode: modes.includes(saved.mode) ? saved.mode : defaults.mode,
          light: exists(saved.light) ? saved.light : defaults.light,
          dark: exists(saved.dark) ? saved.dark : defaults.dark,
          templates,
        };
      }
      const previous = localStorage.getItem("maincreate-theme");
      if (previous === "midnight") return { ...defaults, mode: "dark" };
      if (Object.hasOwn(presets, previous)) return { ...defaults, light: previous };
    } catch {}
    return { ...defaults };
  }

  function luminance(color) {
    const rgb = color.slice(1).match(/../g).map(pair => {
      const channel = parseInt(pair, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  }

  function contrast(first, second) {
    const a = luminance(first) + 0.05;
    const b = luminance(second) + 0.05;
    return Math.max(a, b) / Math.min(a, b);
  }

  let settings = read();
  const customTokens = [...colors, "muted", "line", "accent-hover", "soft", "tag"];

  function apply() {
    const dark = settings.mode === "dark" || (settings.mode === "system" && device.matches);
    const id = settings[dark ? "dark" : "light"];
    const custom = settings.templates.find(template => template.id === id);
    document.body.dataset.theme = custom ? "custom" : id;
    const style = document.body.style;
    for (const token of customTokens) style.removeProperty("--" + token);
    style.removeProperty("color-scheme");
    if (custom) {
      const tokens = {
        ...Object.fromEntries(colors.map(color => [color, custom[color]])),
        muted: "color-mix(in srgb, var(--text) 82%, var(--surface))",
        line: "color-mix(in srgb, var(--text) 18%, var(--surface))",
        "accent-hover": "var(--accent)",
        soft: "color-mix(in srgb, var(--accent) 12%, var(--surface))",
        tag: "var(--soft)",
      };
      for (const [name, value] of Object.entries(tokens)) style.setProperty("--" + name, value);
      style.setProperty("color-scheme", luminance(custom.bg) < 0.18 ? "dark" : "light");
    }
    return id;
  }

  function save(next) {
    localStorage.setItem(key, JSON.stringify(next));
    settings = next;
    return apply();
  }

  apply();
  device.addEventListener("change", apply);
  window.addEventListener("storage", event => {
    if (event.key === key || event.key === null) {
      settings = read();
      apply();
    }
  });
  return { presets, defaults, colors, contrast, read: () => settings, save, apply };
})();
