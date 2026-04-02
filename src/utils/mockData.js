import { subDays, subHours } from 'date-fns';

export const DATE_WINDOWS = [
  { id: '24h', label: '24h', i18nKey: '24h', hours: 24 },
  { id: '72h', label: '3 days', i18nKey: '3days', hours: 72 },
  { id: '168h', label: '7 days', i18nKey: '7days', hours: 168 },
  { id: '720h', label: '30 days', i18nKey: '30days', hours: 720 },
  { id: 'all', label: 'All', i18nKey: 'all', hours: null }
];

export const SORT_OPTIONS = [
  { id: 'severity', label: 'Severity', i18nKey: 'severity' },
  { id: 'latest', label: 'Recent', i18nKey: 'recent' }
];

export function getMockNews() {
  const now = new Date();
  return [
  {
    id: 'sd-darfur',
    title: 'Displacement surge overwhelms makeshift camps',
    summary: 'Thousands of families are sheltering in open ground as aid corridors remain contested.',
    severity: 94,
    publishedAt: subHours(now, 1).toISOString(),
    region: 'Sudan',
    isoA2: 'SD',
    locality: 'North Darfur',
    category: 'Humanitarian',
    coordinates: [13.5, 25.3]
  },
  {
    id: 'jp-ishikawa',
    title: 'Aftershock response continues in smaller coastal towns',
    summary: 'Inspection teams are clearing damaged homes and unstable roads outside the main urban corridor.',
    severity: 91,
    publishedAt: subHours(now, 2).toISOString(),
    region: 'Japan',
    isoA2: 'JP',
    locality: 'Noto Peninsula',
    category: 'Seismic',
    coordinates: [37.3, 136.8]
  },
  {
    id: 'cd-kivu',
    title: 'Displacement wave follows eruption of armed clashes',
    summary: 'Families are moving toward overcrowded transit sites as access roads become insecure.',
    severity: 90,
    publishedAt: subHours(now, 5).toISOString(),
    region: 'Dem. Rep. Congo',
    isoA2: 'CD',
    locality: 'North Kivu',
    category: 'Humanitarian',
    coordinates: [-1.7, 29.2]
  },
  {
    id: 'ua-kharkiv',
    title: 'Power grid repairs stall in frontline districts',
    summary: 'Rolling blackouts continue as repair teams face restricted access to damaged substations.',
    severity: 89,
    publishedAt: subHours(now, 4).toISOString(),
    region: 'Ukraine',
    isoA2: 'UA',
    locality: 'Kharkiv Oblast',
    category: 'Infrastructure',
    coordinates: [49.99, 36.23]
  },
  {
    id: 'us-cascades',
    title: 'Wildfire front expands through the Cascades',
    summary: 'Smoke is pushing into smaller towns while highway access remains open for staged evacuations.',
    severity: 88,
    publishedAt: subHours(now, 3).toISOString(),
    region: 'United States',
    isoA2: 'US',
    locality: 'Chelan County, Washington',
    category: 'Climate',
    coordinates: [47.8, -120.3]
  },
  {
    id: 'au-kimberley',
    title: 'Floodwater isolates cattle stations in the Kimberley',
    summary: 'Air drops are being prioritized for communities far beyond sealed road access.',
    severity: 84,
    publishedAt: subHours(now, 10).toISOString(),
    region: 'Australia',
    isoA2: 'AU',
    locality: 'East Kimberley',
    category: 'Weather',
    coordinates: [-16.4, 126.3]
  },
  {
    id: 'ng-borno',
    title: 'Aid convoy delays intensify pressure near the Lake Chad basin',
    summary: 'Rural distribution routes remain difficult after repeated security interruptions.',
    severity: 82,
    publishedAt: subHours(now, 9).toISOString(),
    region: 'Nigeria',
    isoA2: 'NG',
    locality: 'Borno State',
    category: 'Humanitarian',
    coordinates: [11.7, 13.1]
  },
  {
    id: 'ph-visayas',
    title: 'Typhoon remnants lash fishing communities',
    summary: 'Storm surge warnings extend to smaller islands where evacuation options remain limited.',
    severity: 81,
    publishedAt: subHours(now, 8).toISOString(),
    region: 'Philippines',
    isoA2: 'PH',
    locality: 'Eastern Visayas',
    category: 'Weather',
    coordinates: [11.0, 125.0]
  },
  {
    id: 'br-amazonas',
    title: 'River levels drop further in western Amazon corridors',
    summary: 'Low water is slowing fuel and food deliveries to settlements away from the main road network.',
    severity: 79,
    publishedAt: subHours(now, 7).toISOString(),
    region: 'Brazil',
    isoA2: 'BR',
    locality: 'Tabatinga, Amazonas',
    category: 'Climate',
    coordinates: [-4.2, -69.9]
  },
  {
    id: 'de-saxony',
    title: 'Industrial fire triggers shelter advisories in Saxony',
    summary: 'Plumes are drifting over smaller towns downwind of a chemical processing site.',
    severity: 77,
    publishedAt: subHours(now, 14).toISOString(),
    region: 'Germany',
    isoA2: 'DE',
    locality: 'Bautzen District',
    category: 'Industrial',
    coordinates: [51.2, 14.4]
  },
  {
    id: 'id-papua',
    title: 'Communications outage leaves interior highland towns offline',
    summary: 'Backup satellite links are being rationed while crews repair damaged relays.',
    severity: 76,
    publishedAt: subHours(now, 13).toISOString(),
    region: 'Indonesia',
    isoA2: 'ID',
    locality: 'Central Papua',
    category: 'Infrastructure',
    coordinates: [-4.2, 138.1]
  },
  {
    id: 'pk-sindh',
    title: 'Extreme heat strains water supply in rural districts',
    summary: 'Temperatures exceeding 48°C are depleting open reservoirs faster than they can be refilled.',
    severity: 75,
    publishedAt: subHours(now, 12).toISOString(),
    region: 'Pakistan',
    isoA2: 'PK',
    locality: 'Tharparkar, Sindh',
    category: 'Climate',
    coordinates: [24.7, 69.8]
  },
  {
    id: 'mx-oaxaca',
    title: 'Aftershocks unsettle mountain villages in Oaxaca',
    summary: 'Emergency crews are checking roads and hillside housing after a sequence of overnight tremors.',
    severity: 73,
    publishedAt: subHours(now, 11).toISOString(),
    region: 'Mexico',
    isoA2: 'MX',
    locality: 'Sierra Sur, Oaxaca',
    category: 'Seismic',
    coordinates: [16.1, -96.7]
  },
  {
    id: 'th-chiang-rai',
    title: 'Flash floods submerge border district markets',
    summary: 'Rescue boats are being staged for areas where road access has been completely severed.',
    severity: 72,
    publishedAt: subHours(now, 15).toISOString(),
    region: 'Thailand',
    isoA2: 'TH',
    locality: 'Chiang Rai Province',
    category: 'Weather',
    coordinates: [20.1, 99.8]
  },
  {
    id: 'in-ladakh',
    title: 'Mountain pass closures slow movement into Ladakh',
    summary: 'Snow and rockfall are straining supplies bound for high-altitude villages.',
    severity: 71,
    publishedAt: subHours(now, 6).toISOString(),
    region: 'India',
    isoA2: 'IN',
    locality: 'Leh District',
    category: 'Weather',
    coordinates: [34.15, 77.58]
  },
  {
    id: 'co-choco',
    title: 'Flooding isolates river communities in the Pacific lowlands',
    summary: 'Overflowing tributaries have severed road links to settlements that depend on weekly supply runs.',
    severity: 68,
    publishedAt: subHours(now, 22).toISOString(),
    region: 'Colombia',
    isoA2: 'CO',
    locality: 'Chocó Department',
    category: 'Weather',
    coordinates: [5.7, -76.6]
  },
  {
    id: 'cn-sichuan',
    title: 'Landslide watch issued across mountain prefectures',
    summary: 'Heavy rain is raising the risk of road failures connecting remote valleys.',
    severity: 67,
    publishedAt: subHours(now, 16).toISOString(),
    region: 'China',
    isoA2: 'CN',
    locality: 'Garze, Sichuan',
    category: 'Weather',
    coordinates: [31.6, 100.3]
  },
  {
    id: 'eg-sinai',
    title: 'Flash flooding cuts desert access roads in South Sinai',
    summary: 'Travel into outlying settlements is restricted while drainage corridors are cleared.',
    severity: 64,
    publishedAt: subHours(now, 20).toISOString(),
    region: 'Egypt',
    isoA2: 'EG',
    locality: 'Saint Catherine',
    category: 'Weather',
    coordinates: [28.56, 33.95]
  },
  {
    id: 'fr-guyana',
    title: 'Riverbank erosion threatens isolated settlements',
    summary: 'Authorities are tracking housing instability along transport routes that depend on river access.',
    severity: 62,
    publishedAt: subDays(now, 4).toISOString(),
    region: 'France',
    isoA2: 'FR',
    locality: 'French Guiana interior',
    category: 'Climate',
    coordinates: [4.2, -53.3]
  },
  {
    id: 'ru-yakutia',
    title: 'Permafrost damage threatens remote pipeline access roads',
    summary: 'Ground subsidence is complicating logistics for settlements served by seasonal routes.',
    severity: 60,
    publishedAt: subDays(now, 3).toISOString(),
    region: 'Russia',
    isoA2: 'RU',
    locality: 'Sakha Republic',
    category: 'Infrastructure',
    coordinates: [62.0, 129.7]
  },
  {
    id: 'is-fjords',
    title: 'Harbor closures isolate fishing villages in the Westfjords',
    summary: 'Seas remain rough enough to suspend ferry access and routine cargo movement.',
    severity: 58,
    publishedAt: subDays(now, 1).toISOString(),
    region: 'Iceland',
    isoA2: 'IS',
    locality: 'Isafjordur',
    category: 'Weather',
    coordinates: [66.1, -23.1]
  },
  {
    id: 'no-nordland',
    title: 'Landslide blocks sole highway serving fjord settlements',
    summary: 'Emergency ferry service is being arranged while geologists assess slope stability.',
    severity: 55,
    publishedAt: subDays(now, 1).toISOString(),
    region: 'Norway',
    isoA2: 'NO',
    locality: 'Nordland',
    category: 'Seismic',
    coordinates: [67.3, 15.4]
  },
  {
    id: 'pe-apurimac',
    title: 'Protests halt transport near mining corridor',
    summary: 'Community blockades are disrupting supply chains for both the mine and surrounding towns.',
    severity: 53,
    publishedAt: subDays(now, 2).toISOString(),
    region: 'Peru',
    isoA2: 'PE',
    locality: 'Apurímac',
    category: 'Civil',
    coordinates: [-14.0, -73.1]
  },
  {
    id: 'ca-nunavut',
    title: 'Supply flights delayed across remote Arctic communities',
    summary: 'Weather pressure has disrupted deliveries and medical transfers serving isolated settlements.',
    severity: 52,
    publishedAt: subHours(now, 18).toISOString(),
    region: 'Canada',
    isoA2: 'CA',
    locality: 'Nunavut',
    category: 'Infrastructure',
    coordinates: [63.7, -68.5]
  },
  {
    id: 'za-limpopo',
    title: 'Water restrictions widen across farming districts',
    summary: 'Reservoir drawdown is forcing staggered access for smaller communities and irrigation users.',
    severity: 47,
    publishedAt: subDays(now, 3).toISOString(),
    region: 'South Africa',
    isoA2: 'ZA',
    locality: 'Limpopo',
    category: 'Climate',
    coordinates: [-23.9, 29.4]
  },
  {
    id: 'nz-fiordland',
    title: 'Heavy rain warnings disrupt Fiordland access routes',
    summary: 'Tour and supply traffic into remote fjord communities is being staged around washouts.',
    severity: 44,
    publishedAt: subDays(now, 1).toISOString(),
    region: 'New Zealand',
    isoA2: 'NZ',
    locality: 'Fiordland',
    category: 'Weather',
    coordinates: [-45.4, 167.7]
  },
  {
    id: 'ar-patagonia',
    title: 'Patagonian windstorm cuts power to sparse ranch belts',
    summary: 'Crews are restoring lines while grazing routes remain partially blocked by debris.',
    severity: 41,
    publishedAt: subDays(now, 2).toISOString(),
    region: 'Argentina',
    isoA2: 'AR',
    locality: 'Santa Cruz Province',
    category: 'Weather',
    coordinates: [-49.3, -71.9]
  },
  {
    id: 'gb-london',
    title: 'Transit strike crowds central London interchange zones',
    summary: 'Commuter delays are spreading through rail and underground links during the evening peak.',
    severity: 36,
    publishedAt: subHours(now, 5).toISOString(),
    region: 'United Kingdom',
    isoA2: 'GB',
    locality: 'London',
    category: 'Civil',
    coordinates: [51.5072, -0.1276]
  }
  ];
}

export const getSeverityMeta = (severity) => {
  if (severity >= 85) {
    return {
      label: 'Critical',
      labelKey: 'critical',
      accent: '#ff3b5c',
      muted: 'rgba(255, 59, 92, 0.15)',
      mapFill: 'rgba(255, 59, 92, 0.6)',
      mapSide: 'rgba(255, 59, 92, 0.28)',
      ring: 'rgba(255, 59, 92, 0.8)'
    };
  }

  if (severity >= 60) {
    return {
      label: 'Elevated',
      labelKey: 'elevated',
      accent: '#ff8a3d',
      muted: 'rgba(255, 138, 61, 0.15)',
      mapFill: 'rgba(255, 138, 61, 0.55)',
      mapSide: 'rgba(255, 138, 61, 0.25)',
      ring: 'rgba(255, 138, 61, 0.75)'
    };
  }

  if (severity >= 35) {
    return {
      label: 'Watch',
      labelKey: 'watch',
      accent: '#ffc93e',
      muted: 'rgba(255, 201, 62, 0.15)',
      mapFill: 'rgba(255, 201, 62, 0.5)',
      mapSide: 'rgba(255, 201, 62, 0.22)',
      ring: 'rgba(255, 201, 62, 0.7)'
    };
  }

  return {
    label: 'Low',
    labelKey: 'low',
    accent: '#3ee8b0',
    muted: 'rgba(62, 232, 176, 0.12)',
    mapFill: 'rgba(62, 232, 176, 0.45)',
    mapSide: 'rgba(62, 232, 176, 0.2)',
    ring: 'rgba(62, 232, 176, 0.65)'
  };
};

export const resolveDateFloor = (windowId, startDate) => {
  const candidates = [];
  const config = DATE_WINDOWS.find((opt) => opt.id === windowId);

  if (config?.hours) {
    candidates.push(new Date(Date.now() - config.hours * 60 * 60 * 1000));
  }

  if (startDate) {
    const d = new Date(`${startDate}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      candidates.push(d);
    }
  }

  if (!candidates.length) return null;

  return candidates.reduce((latest, c) => (c > latest ? c : latest));
};

export const calculateRegionSeverity = (newsList) => {
  const regions = {};

  newsList.forEach((story) => {
    if (!regions[story.isoA2]) {
      regions[story.isoA2] = {
        count: 0,
        totalSeverity: 0,
        averageSeverity: 0,
        peakSeverity: 0,
        latestStory: null,
        peakStory: null,
        region: story.region
      };
    }

    const r = regions[story.isoA2];
    r.count += 1;
    r.totalSeverity += story.severity;
    r.peakSeverity = Math.max(r.peakSeverity, story.severity);

    if (!r.latestStory || new Date(story.publishedAt) > new Date(r.latestStory.publishedAt)) {
      r.latestStory = story;
    }

    if (!r.peakStory || story.severity > r.peakStory.severity) {
      r.peakStory = story;
    }
  });

  Object.values(regions).forEach((r) => {
    r.averageSeverity = r.totalSeverity / r.count;
  });

  return regions;
};
