export default function RouteTemplate({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="route-transition">{children}</div>;
}
