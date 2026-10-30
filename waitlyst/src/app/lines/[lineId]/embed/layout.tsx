// The root layout supplies <html>/<body> and leaves out the site header and
// footer on this route (see SiteChrome); nesting another <html> here was
// invalid and still showed the site chrome inside the iframe.
export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <div className="bg-white">{children}</div>
}
