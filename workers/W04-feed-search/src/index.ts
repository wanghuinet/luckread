const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        service: "W04",
        status: "ok",
        role: "feed-recommendation-search",
        mode: "bootstrap",
      });
    }

    return new Response(null, { status: 404 });
  },
};
