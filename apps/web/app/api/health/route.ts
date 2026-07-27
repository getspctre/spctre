export const dynamic = "force-dynamic";

function handleGetApiHealth() {
  return Response.json({ ok: true }, { status: 200 });
}

export { handleGetApiHealth as GET };
