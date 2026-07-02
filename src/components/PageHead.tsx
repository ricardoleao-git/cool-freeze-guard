import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";

const SITE = "https://camara-temporizada.zenitetech.com";

interface PageHeadProps {
  title: string;
  description: string;
  ogType?: "website" | "article";
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

export default function PageHead({ title, description, ogType = "website", jsonLd }: PageHeadProps) {
  const { pathname } = useLocation();
  const url = `${SITE}${pathname}`;
  const ldArray = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:type" content={ogType} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      {ldArray.map((ld, i) => (
        <script key={i} type="application/ld+json">{JSON.stringify(ld)}</script>
      ))}
    </Helmet>
  );
}
