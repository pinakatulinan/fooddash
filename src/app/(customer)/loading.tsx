/**
 * Discovery's route-level loading state - Next.js renders this instantly
 * while the page's `nearby_merchants` call is still in flight, so the first
 * paint is a shaped shimmer instead of a blank frame or a spinner. Shape
 * matches the real page (header band, chip row, card grid) so the swap-in
 * doesn't jump.
 */
export default function DiscoverLoading() {
  return (
    <>
      <div className="bg-header px-4 pt-5 pb-6">
        <div className="fd-skeleton h-3 w-40" />
        <div className="fd-skeleton mt-3 h-7 w-56" />
        <div className="fd-skeleton mt-2 h-4 w-48" />
      </div>

      <div className="space-y-8 px-4 py-6">
        <div className="flex gap-2">
          <div className="fd-skeleton h-9 w-24 rounded-pill" />
          <div className="fd-skeleton h-9 w-28 rounded-pill" />
          <div className="fd-skeleton h-9 w-20 rounded-pill" />
        </div>

        <div>
          <div className="fd-skeleton mb-3 h-4 w-24" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-lg border border-line">
                <div className="fd-skeleton h-40" />
                <div className="space-y-2 p-4">
                  <div className="fd-skeleton h-4 w-3/4" />
                  <div className="fd-skeleton h-3 w-1/2" />
                  <div className="fd-skeleton h-5 w-2/3 rounded-pill" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
