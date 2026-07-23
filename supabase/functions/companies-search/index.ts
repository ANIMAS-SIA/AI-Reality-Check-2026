import { errorResponse, handleOptions, jsonResponse, requiredEnv } from "../_shared/http.ts";

type C360Company = {
  name?: string;
  registration_number?: string;
  country?: string;
  status?: string;
  legal_form?: string;
  registered_date?: string;
  address?: string;
  nace_code?: string;
  industry?: string;
  nace_text?: string;
  company_size?: string;
  company_size_badge?: string;
  region?: string;
};

function normalize(item: C360Company) {
  return {
    name: item.name || "",
    registration_number: item.registration_number || "",
    country: item.country || "LV",
    status: item.status || "",
    legal_form: item.legal_form || "",
    registered_date: item.registered_date || "",
    address: item.address || "",
    nace_code: item.nace_code || "",
    industry: item.industry || item.nace_text || "",
    nace_text: item.nace_text || "",
    company_size: item.company_size || "",
    company_size_badge: item.company_size_badge || "",
    region: item.region || "",
  };
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  if (request.method !== "GET") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const requestUrl = new URL(request.url);
    const q = (requestUrl.searchParams.get("q") || "").trim();
    if (q.length < 2) return jsonResponse({ companies: [] });

    const apiBase = Deno.env.get("C360_API_BASE") || "https://api.company360.lv";
    const apiKey = requiredEnv("C360_API_KEY");
    const c360Url = new URL("/v1/search", apiBase);
    c360Url.searchParams.set("q", q);
    c360Url.searchParams.set("country", requestUrl.searchParams.get("country") || "LV");
    c360Url.searchParams.set("page", requestUrl.searchParams.get("page") || "1");
    c360Url.searchParams.set("page_size", requestUrl.searchParams.get("page_size") || "20");

    const response = await fetch(c360Url, {
      headers: { "X-API-Key": apiKey },
    });

    if (!response.ok) {
      return errorResponse("Company search failed", response.status);
    }

    const data = await response.json();
    const rows = data.results || data.items || data.companies || data;
    const companies = Array.isArray(rows) ? rows.map(normalize) : [];

    return jsonResponse({ companies });
  } catch (error) {
    return errorResponse("Company search failed", 500, String(error));
  }
});
