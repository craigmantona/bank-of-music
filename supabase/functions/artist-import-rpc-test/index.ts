Deno.serve(() => {
  return Response.json(
    {
      ok: false,
      error: "This production diagnostic is disabled pending removal."
    },
    { status: 410 }
  );
});
