// ESMA's interim MiCA register, bundled (see tools/make_register.py).
import { readFileSync } from "node:fs";

const REGISTER = JSON.parse(readFileSync(new URL("../data/register.json", import.meta.url), "utf8"));
export const CHECKLIST = JSON.parse(readFileSync(new URL("../data/checklist.json", import.meta.url), "utf8"));

// Hosts shared by many unrelated sites are never treated as a firm's own.
const SHARED_HOSTS = /(^|\.)(figma\.com|google\.com|linkedin\.com|github\.io|notion\.site|wixsite\.com|webflow\.io)$/i;

export function isSharedSite(url) {
  try {
    return SHARED_HOSTS.test(new URL(url).hostname);
  } catch {
    return true;
  }
}

// The part of a host name a firm actually owns: bitpanda.com, cc.com.mt.
export function siteKey(host) {
  const parts = String(host || "").toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const sld = parts[parts.length - 2];
  const twoLevel = ["co", "com", "org", "net", "gov", "ac"].includes(sld) && parts[parts.length - 1].length === 2;
  return parts.slice(twoLevel ? -3 : -2).join(".");
}

const BY_KEY = new Map();
for (const firm of REGISTER.firms) {
  for (const site of firm.w) {
    try {
      const host = new URL(site).hostname;
      if (SHARED_HOSTS.test(host)) continue;
      const key = siteKey(host);
      if (!BY_KEY.has(key)) BY_KEY.set(key, firm);
    } catch {
      // a register entry that is not a URL: nothing to index
    }
  }
}

export const registerAsOf = REGISTER.as_of;
export const serviceNames = REGISTER.services;

export function firmByLei(lei) {
  return REGISTER.firms.find((f) => f.lei && f.lei === String(lei || "").trim().toUpperCase()) || null;
}

export function firmByHost(host) {
  return BY_KEY.get(siteKey(host)) || null;
}

export function registerSiteOk(firm) {
  return firm.w.some((site) => {
    try {
      return !SHARED_HOSTS.test(new URL(site).hostname);
    } catch {
      return false;
    }
  });
}

export function publicFirm(firm) {
  if (!firm) return null;
  return {
    name: firm.n, commercial_name: firm.c, lei: firm.lei, state: firm.s, authority: firm.a,
    services: firm.sv.split(""), register_sites: firm.w, authorised: firm.d,
  };
}
