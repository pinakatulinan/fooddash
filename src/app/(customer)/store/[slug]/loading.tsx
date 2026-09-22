/** Shape matches the real store page: cover, header band, then menu rows. */
export default function StoreLoading() {
  return (
    <>
      <div className="fd-skeleton h-40" />

      <div className="bg-header px-4 pt-5 pb-6">
        <div className="flex items-start gap-3">
          <div className="fd-skeleton size-12 shrink-0 rounded-pill" />
          <div className="min-w-0 flex-1 space-y-2 pt-1">
            <div className="fd-skeleton h-6 w-2/3" />
            <div className="fd-skeleton h-3.5 w-1/2" />
          </div>
        </div>
        <div className="fd-skeleton mt-4 h-4 w-3/4" />
      </div>

      <div className="space-y-2 px-4 py-6">
        <div className="fd-skeleton mb-3 h-4 w-32" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-start gap-4 rounded-lg border border-line p-4">
            <div className="flex-1 space-y-2">
              <div className="fd-skeleton h-4 w-2/3" />
              <div className="fd-skeleton h-3.5 w-full" />
              <div className="fd-skeleton h-4 w-16" />
            </div>
            <div className="fd-skeleton size-24 shrink-0" />
          </div>
        ))}
      </div>
    </>
  );
}
