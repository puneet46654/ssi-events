// Relative Location: behind CloudFront and Lambda, request.url carries the internal host.
export function GET() {
  return new Response(null, { status: 307, headers: { Location: '/admin/check-in' } });
}
