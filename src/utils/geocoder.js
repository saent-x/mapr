// Built-in city/region database for client-side geocoding.
// Covers major cities, conflict zones, disaster-prone regions, and country centroids.
// No external API needed — runs entirely in the browser.

const LOCATIONS = [
  // Africa
  { name: 'Cairo', country: 'Egypt', lat: 30.04, lng: 31.24 },
  { name: 'Alexandria', country: 'Egypt', lat: 31.2, lng: 29.92 },
  { name: 'Sinai', country: 'Egypt', lat: 29.5, lng: 33.8 },
  { name: 'Lagos', country: 'Nigeria', lat: 6.45, lng: 3.4 },
  { name: 'Abuja', country: 'Nigeria', lat: 9.06, lng: 7.49 },
  { name: 'Borno', country: 'Nigeria', lat: 11.8, lng: 13.15 },
  { name: 'Maiduguri', country: 'Nigeria', lat: 11.85, lng: 13.16 },
  { name: 'Kano', country: 'Nigeria', lat: 12.0, lng: 8.52 },
  { name: 'Johannesburg', country: 'South Africa', lat: -26.2, lng: 28.04 },
  { name: 'Cape Town', country: 'South Africa', lat: -33.93, lng: 18.42 },
  { name: 'Durban', country: 'South Africa', lat: -29.86, lng: 31.02 },
  { name: 'Limpopo', country: 'South Africa', lat: -23.9, lng: 29.45 },
  { name: 'Nairobi', country: 'Kenya', lat: -1.29, lng: 36.82 },
  { name: 'Mombasa', country: 'Kenya', lat: -4.04, lng: 39.67 },
  { name: 'Addis Ababa', country: 'Ethiopia', lat: 9.02, lng: 38.75 },
  { name: 'Tigray', country: 'Ethiopia', lat: 13.5, lng: 39.5 },
  { name: 'Khartoum', country: 'Sudan', lat: 15.59, lng: 32.53 },
  { name: 'Darfur', country: 'Sudan', lat: 13.5, lng: 25.3 },
  { name: 'Port Sudan', country: 'Sudan', lat: 19.62, lng: 37.22 },
  { name: 'Mogadishu', country: 'Somalia', lat: 2.05, lng: 45.34 },
  { name: 'Kinshasa', country: 'Dem. Rep. Congo', lat: -4.32, lng: 15.31 },
  { name: 'Goma', country: 'Dem. Rep. Congo', lat: -1.68, lng: 29.23 },
  { name: 'Kivu', country: 'Dem. Rep. Congo', lat: -1.7, lng: 29.2 },
  { name: 'Accra', country: 'Ghana', lat: 5.56, lng: -0.2 },
  { name: 'Dakar', country: 'Senegal', lat: 14.69, lng: -17.44 },
  { name: 'Tripoli', country: 'Libya', lat: 32.9, lng: 13.18 },
  { name: 'Benghazi', country: 'Libya', lat: 32.12, lng: 20.07 },
  { name: 'Tunis', country: 'Tunisia', lat: 36.81, lng: 10.17 },
  { name: 'Algiers', country: 'Algeria', lat: 36.75, lng: 3.04 },
  { name: 'Casablanca', country: 'Morocco', lat: 33.57, lng: -7.59 },
  { name: 'Kampala', country: 'Uganda', lat: 0.35, lng: 32.6 },
  { name: 'Bamako', country: 'Mali', lat: 12.64, lng: -8.0 },
  { name: 'Maputo', country: 'Mozambique', lat: -25.97, lng: 32.58 },
  { name: 'Cabo Delgado', country: 'Mozambique', lat: -12.2, lng: 40.6 },
  { name: 'Harare', country: 'Zimbabwe', lat: -17.83, lng: 31.05 },
  { name: 'Luanda', country: 'Angola', lat: -8.84, lng: 13.23 },
  { name: 'Dar es Salaam', country: 'Tanzania', lat: -6.79, lng: 39.28 },
  { name: 'Dodoma', country: 'Tanzania', lat: -6.17, lng: 35.74 },
  { name: 'Lusaka', country: 'Zambia', lat: -15.39, lng: 28.32 },
  { name: 'Kigali', country: 'Rwanda', lat: -1.94, lng: 29.87 },
  { name: 'Douala', country: 'Cameroon', lat: 4.05, lng: 9.77 },
  { name: 'Yaounde', country: 'Cameroon', lat: 3.87, lng: 11.52 },
  { name: 'Abidjan', country: 'Ivory Coast', lat: 5.36, lng: -4.01 },
  { name: 'Freetown', country: 'Sierra Leone', lat: 8.48, lng: -13.23 },
  { name: 'Port Harcourt', country: 'Nigeria', lat: 4.82, lng: 7.03 },
  { name: 'Ibadan', country: 'Nigeria', lat: 7.4, lng: 3.9 },
  { name: 'Enugu', country: 'Nigeria', lat: 6.44, lng: 7.5 },
  { name: 'Kaduna', country: 'Nigeria', lat: 10.52, lng: 7.43 },
  { name: 'Juba', country: 'South Sudan', lat: 4.85, lng: 31.61 },
  { name: 'Antananarivo', country: 'Madagascar', lat: -18.91, lng: 47.54 },
  { name: 'Lilongwe', country: 'Malawi', lat: -13.96, lng: 33.79 },
  { name: 'Windhoek', country: 'Namibia', lat: -22.56, lng: 17.08 },
  { name: 'Gaborone', country: 'Botswana', lat: -24.65, lng: 25.91 },

  // Middle East
  { name: 'Gaza', country: 'Palestine', lat: 31.5, lng: 34.47 },
  { name: 'West Bank', country: 'Palestine', lat: 31.95, lng: 35.2 },
  { name: 'Tel Aviv', country: 'Israel', lat: 32.08, lng: 34.78 },
  { name: 'Jerusalem', country: 'Israel', lat: 31.77, lng: 35.23 },
  { name: 'Baghdad', country: 'Iraq', lat: 33.31, lng: 44.37 },
  { name: 'Mosul', country: 'Iraq', lat: 36.34, lng: 43.12 },
  { name: 'Basra', country: 'Iraq', lat: 30.51, lng: 47.81 },
  { name: 'Damascus', country: 'Syria', lat: 33.51, lng: 36.29 },
  { name: 'Aleppo', country: 'Syria', lat: 36.2, lng: 37.16 },
  { name: 'Idlib', country: 'Syria', lat: 35.93, lng: 36.63 },
  { name: 'Tehran', country: 'Iran', lat: 35.69, lng: 51.39 },
  { name: 'Beirut', country: 'Lebanon', lat: 33.89, lng: 35.5 },
  { name: 'Amman', country: 'Jordan', lat: 31.95, lng: 35.93 },
  { name: 'Riyadh', country: 'Saudi Arabia', lat: 24.71, lng: 46.68 },
  { name: 'Jeddah', country: 'Saudi Arabia', lat: 21.49, lng: 39.19 },
  { name: 'Dubai', country: 'United Arab Emirates', lat: 25.2, lng: 55.27 },
  { name: 'Doha', country: 'Qatar', lat: 25.29, lng: 51.53 },
  { name: 'Sanaa', country: 'Yemen', lat: 15.37, lng: 44.19 },
  { name: 'Aden', country: 'Yemen', lat: 12.79, lng: 45.04 },
  { name: 'Kabul', country: 'Afghanistan', lat: 34.53, lng: 69.17 },
  { name: 'Kandahar', country: 'Afghanistan', lat: 31.61, lng: 65.71 },
  { name: 'Abu Dhabi', country: 'United Arab Emirates', lat: 24.45, lng: 54.65 },
  { name: 'Muscat', country: 'Oman', lat: 23.61, lng: 58.54 },
  { name: 'Kuwait City', country: 'Kuwait', lat: 29.38, lng: 47.99 },
  { name: 'Manama', country: 'Bahrain', lat: 26.23, lng: 50.59 },
  { name: 'Isfahan', country: 'Iran', lat: 32.65, lng: 51.68 },
  { name: 'Tabriz', country: 'Iran', lat: 38.08, lng: 46.29 },
  { name: 'Erbil', country: 'Iraq', lat: 36.19, lng: 44.01 },

  // Europe
  { name: 'London', country: 'United Kingdom', lat: 51.51, lng: -0.13 },
  { name: 'Manchester', country: 'United Kingdom', lat: 53.48, lng: -2.24 },
  { name: 'Edinburgh', country: 'United Kingdom', lat: 55.95, lng: -3.19 },
  { name: 'Paris', country: 'France', lat: 48.86, lng: 2.35 },
  { name: 'Marseille', country: 'France', lat: 43.3, lng: 5.37 },
  { name: 'Lyon', country: 'France', lat: 45.76, lng: 4.84 },
  { name: 'Berlin', country: 'Germany', lat: 52.52, lng: 13.41 },
  { name: 'Munich', country: 'Germany', lat: 48.14, lng: 11.58 },
  { name: 'Hamburg', country: 'Germany', lat: 53.55, lng: 9.99 },
  { name: 'Saxony', country: 'Germany', lat: 51.1, lng: 13.2 },
  { name: 'Bautzen', country: 'Germany', lat: 51.18, lng: 14.42 },
  { name: 'Madrid', country: 'Spain', lat: 40.42, lng: -3.7 },
  { name: 'Barcelona', country: 'Spain', lat: 41.39, lng: 2.17 },
  { name: 'Rome', country: 'Italy', lat: 41.9, lng: 12.5 },
  { name: 'Milan', country: 'Italy', lat: 45.46, lng: 9.19 },
  { name: 'Naples', country: 'Italy', lat: 40.85, lng: 14.27 },
  { name: 'Athens', country: 'Greece', lat: 37.98, lng: 23.73 },
  { name: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14 },
  { name: 'Amsterdam', country: 'Netherlands', lat: 52.37, lng: 4.9 },
  { name: 'Brussels', country: 'Belgium', lat: 50.85, lng: 4.35 },
  { name: 'Vienna', country: 'Austria', lat: 48.21, lng: 16.37 },
  { name: 'Zurich', country: 'Switzerland', lat: 47.38, lng: 8.54 },
  { name: 'Geneva', country: 'Switzerland', lat: 46.2, lng: 6.14 },
  { name: 'Warsaw', country: 'Poland', lat: 52.23, lng: 21.01 },
  { name: 'Prague', country: 'Czech Republic', lat: 50.08, lng: 14.44 },
  { name: 'Budapest', country: 'Hungary', lat: 47.5, lng: 19.04 },
  { name: 'Bucharest', country: 'Romania', lat: 44.43, lng: 26.1 },
  { name: 'Stockholm', country: 'Sweden', lat: 59.33, lng: 18.07 },
  { name: 'Oslo', country: 'Norway', lat: 59.91, lng: 10.75 },
  { name: 'Nordland', country: 'Norway', lat: 67.3, lng: 15.4 },
  { name: 'Copenhagen', country: 'Denmark', lat: 55.68, lng: 12.57 },
  { name: 'Helsinki', country: 'Finland', lat: 60.17, lng: 24.94 },
  { name: 'Reykjavik', country: 'Iceland', lat: 64.14, lng: -21.9 },
  { name: 'Isafjordur', country: 'Iceland', lat: 66.07, lng: -23.13 },
  { name: 'Dublin', country: 'Ireland', lat: 53.35, lng: -6.26 },
  { name: 'Kyiv', country: 'Ukraine', lat: 50.45, lng: 30.52 },
  { name: 'Kharkiv', country: 'Ukraine', lat: 49.99, lng: 36.23 },
  { name: 'Odesa', country: 'Ukraine', lat: 46.48, lng: 30.73 },
  { name: 'Zaporizhzhia', country: 'Ukraine', lat: 47.84, lng: 35.14 },
  { name: 'Kherson', country: 'Ukraine', lat: 46.64, lng: 32.62 },
  { name: 'Moscow', country: 'Russia', lat: 55.76, lng: 37.62 },
  { name: 'Saint Petersburg', country: 'Russia', lat: 59.93, lng: 30.32 },
  { name: 'Yakutia', country: 'Russia', lat: 62.0, lng: 129.7 },
  { name: 'Sakha', country: 'Russia', lat: 62.0, lng: 129.7 },
  { name: 'Belgrade', country: 'Serbia', lat: 44.79, lng: 20.47 },
  { name: 'Istanbul', country: 'Turkey', lat: 41.01, lng: 28.98 },
  { name: 'Ankara', country: 'Turkey', lat: 39.93, lng: 32.85 },
  { name: 'Izmir', country: 'Turkey', lat: 38.42, lng: 27.14 },
  { name: 'Antalya', country: 'Turkey', lat: 36.9, lng: 30.69 },
  { name: 'Bursa', country: 'Turkey', lat: 40.18, lng: 29.05 },
  { name: 'Bratislava', country: 'Slovakia', lat: 48.15, lng: 17.11 },
  { name: 'Ljubljana', country: 'Slovenia', lat: 46.05, lng: 14.51 },
  { name: 'Tallinn', country: 'Estonia', lat: 59.44, lng: 24.75 },
  { name: 'Riga', country: 'Latvia', lat: 56.95, lng: 24.11 },
  { name: 'Vilnius', country: 'Lithuania', lat: 54.69, lng: 25.28 },
  { name: 'Tbilisi', country: 'Georgia', lat: 41.72, lng: 44.79 },
  { name: 'Chisinau', country: 'Moldova', lat: 47.01, lng: 28.86 },

  // Asia
  { name: 'Beijing', country: 'China', lat: 39.9, lng: 116.4 },
  { name: 'Shanghai', country: 'China', lat: 31.23, lng: 121.47 },
  { name: 'Hong Kong', country: 'China', lat: 22.32, lng: 114.17 },
  { name: 'Sichuan', country: 'China', lat: 30.57, lng: 104.07 },
  { name: 'Garze', country: 'China', lat: 31.6, lng: 100.3 },
  { name: 'Xinjiang', country: 'China', lat: 43.79, lng: 87.63 },
  { name: 'Tokyo', country: 'Japan', lat: 35.68, lng: 139.69 },
  { name: 'Osaka', country: 'Japan', lat: 34.69, lng: 135.5 },
  { name: 'Noto', country: 'Japan', lat: 37.3, lng: 136.8 },
  { name: 'Ishikawa', country: 'Japan', lat: 36.59, lng: 136.63 },
  { name: 'Seoul', country: 'South Korea', lat: 37.57, lng: 126.98 },
  { name: 'New Delhi', country: 'India', lat: 28.61, lng: 77.21 },
  { name: 'Mumbai', country: 'India', lat: 19.08, lng: 72.88 },
  { name: 'Chennai', country: 'India', lat: 13.08, lng: 80.27 },
  { name: 'Kolkata', country: 'India', lat: 22.57, lng: 88.36 },
  { name: 'Ladakh', country: 'India', lat: 34.15, lng: 77.58 },
  { name: 'Kashmir', country: 'India', lat: 34.08, lng: 74.8 },
  { name: 'Islamabad', country: 'Pakistan', lat: 33.69, lng: 73.04 },
  { name: 'Karachi', country: 'Pakistan', lat: 24.86, lng: 67.01 },
  { name: 'Lahore', country: 'Pakistan', lat: 31.55, lng: 74.35 },
  { name: 'Sindh', country: 'Pakistan', lat: 25.38, lng: 68.37 },
  { name: 'Tharparkar', country: 'Pakistan', lat: 24.7, lng: 69.8 },
  { name: 'Dhaka', country: 'Bangladesh', lat: 23.81, lng: 90.41 },
  { name: 'Bangkok', country: 'Thailand', lat: 13.76, lng: 100.5 },
  { name: 'Chiang Rai', country: 'Thailand', lat: 19.91, lng: 99.83 },
  { name: 'Chiang Mai', country: 'Thailand', lat: 18.79, lng: 98.98 },
  { name: 'Jakarta', country: 'Indonesia', lat: -6.21, lng: 106.85 },
  { name: 'Papua', country: 'Indonesia', lat: -4.27, lng: 138.08 },
  { name: 'Sulawesi', country: 'Indonesia', lat: -1.43, lng: 121.45 },
  { name: 'Manila', country: 'Philippines', lat: 14.6, lng: 120.98 },
  { name: 'Visayas', country: 'Philippines', lat: 11.0, lng: 124.0 },
  { name: 'Mindanao', country: 'Philippines', lat: 7.13, lng: 125.63 },
  { name: 'Hanoi', country: 'Vietnam', lat: 21.03, lng: 105.85 },
  { name: 'Ho Chi Minh', country: 'Vietnam', lat: 10.82, lng: 106.63 },
  { name: 'Yangon', country: 'Myanmar', lat: 16.87, lng: 96.2 },
  { name: 'Kathmandu', country: 'Nepal', lat: 27.72, lng: 85.32 },
  { name: 'Colombo', country: 'Sri Lanka', lat: 6.93, lng: 79.85 },
  { name: 'Singapore', country: 'Singapore', lat: 1.35, lng: 103.82 },
  { name: 'Kuala Lumpur', country: 'Malaysia', lat: 3.14, lng: 101.69 },
  { name: 'Bangalore', country: 'India', lat: 12.97, lng: 77.59 },
  { name: 'Bengaluru', country: 'India', lat: 12.97, lng: 77.59 },
  { name: 'Hyderabad', country: 'India', lat: 17.39, lng: 78.49 },
  { name: 'Pune', country: 'India', lat: 18.52, lng: 73.86 },
  { name: 'Ahmedabad', country: 'India', lat: 23.02, lng: 72.57 },
  { name: 'Jaipur', country: 'India', lat: 26.92, lng: 75.79 },
  { name: 'Lucknow', country: 'India', lat: 26.85, lng: 80.95 },
  { name: 'Cebu', country: 'Philippines', lat: 10.32, lng: 123.89 },
  { name: 'Davao', country: 'Philippines', lat: 7.19, lng: 125.46 },
  { name: 'Taipei', country: 'Taiwan', lat: 25.03, lng: 121.57 },
  { name: 'Phnom Penh', country: 'Cambodia', lat: 11.56, lng: 104.93 },
  { name: 'Vientiane', country: 'Laos', lat: 17.97, lng: 102.63 },
  { name: 'Ulaanbaatar', country: 'Mongolia', lat: 47.92, lng: 106.91 },
  { name: 'Almaty', country: 'Kazakhstan', lat: 43.24, lng: 76.95 },
  { name: 'Tashkent', country: 'Uzbekistan', lat: 41.3, lng: 69.28 },

  // Americas
  { name: 'Washington', country: 'United States', lat: 38.91, lng: -77.04 },
  { name: 'New York', country: 'United States', lat: 40.71, lng: -74.01 },
  { name: 'Los Angeles', country: 'United States', lat: 34.05, lng: -118.24 },
  { name: 'Chicago', country: 'United States', lat: 41.88, lng: -87.63 },
  { name: 'Houston', country: 'United States', lat: 29.76, lng: -95.37 },
  { name: 'Miami', country: 'United States', lat: 25.76, lng: -80.19 },
  { name: 'San Francisco', country: 'United States', lat: 37.77, lng: -122.42 },
  { name: 'Seattle', country: 'United States', lat: 47.61, lng: -122.33 },
  { name: 'Cascades', country: 'United States', lat: 47.8, lng: -120.3 },
  { name: 'Chelan', country: 'United States', lat: 47.84, lng: -120.02 },
  { name: 'Hawaii', country: 'United States', lat: 19.9, lng: -155.58 },
  { name: 'Alaska', country: 'United States', lat: 64.2, lng: -152.49 },
  { name: 'Texas', country: 'United States', lat: 31.97, lng: -99.9 },
  { name: 'California', country: 'United States', lat: 36.78, lng: -119.42 },
  { name: 'Florida', country: 'United States', lat: 27.66, lng: -81.52 },
  { name: 'Ottawa', country: 'Canada', lat: 45.42, lng: -75.7 },
  { name: 'Toronto', country: 'Canada', lat: 43.65, lng: -79.38 },
  { name: 'Vancouver', country: 'Canada', lat: 49.28, lng: -123.12 },
  { name: 'Nunavut', country: 'Canada', lat: 63.75, lng: -68.52 },
  { name: 'Mexico City', country: 'Mexico', lat: 19.43, lng: -99.13 },
  { name: 'Oaxaca', country: 'Mexico', lat: 17.07, lng: -96.73 },
  { name: 'Tijuana', country: 'Mexico', lat: 32.51, lng: -117.04 },
  { name: 'Guadalajara', country: 'Mexico', lat: 20.67, lng: -103.35 },
  { name: 'Bogota', country: 'Colombia', lat: 4.71, lng: -74.07 },
  { name: 'Choco', country: 'Colombia', lat: 5.69, lng: -76.65 },
  { name: 'Medellin', country: 'Colombia', lat: 6.25, lng: -75.56 },
  { name: 'Sao Paulo', country: 'Brazil', lat: -23.55, lng: -46.63 },
  { name: 'Rio de Janeiro', country: 'Brazil', lat: -22.91, lng: -43.17 },
  { name: 'Amazonas', country: 'Brazil', lat: -3.12, lng: -60.02 },
  { name: 'Tabatinga', country: 'Brazil', lat: -4.25, lng: -69.94 },
  { name: 'Buenos Aires', country: 'Argentina', lat: -34.6, lng: -58.38 },
  { name: 'Patagonia', country: 'Argentina', lat: -46.0, lng: -70.0 },
  { name: 'Santiago', country: 'Chile', lat: -33.45, lng: -70.67 },
  { name: 'Lima', country: 'Peru', lat: -12.05, lng: -77.04 },
  { name: 'Apurimac', country: 'Peru', lat: -14.0, lng: -73.1 },
  { name: 'Caracas', country: 'Venezuela', lat: 10.48, lng: -66.9 },
  { name: 'Havana', country: 'Cuba', lat: 23.11, lng: -82.37 },
  { name: 'Port-au-Prince', country: 'Haiti', lat: 18.54, lng: -72.34 },
  { name: 'Guatemala City', country: 'Guatemala', lat: 14.63, lng: -90.51 },
  { name: 'San Salvador', country: 'El Salvador', lat: 13.69, lng: -89.19 },
  { name: 'Tegucigalpa', country: 'Honduras', lat: 14.07, lng: -87.19 },
  { name: 'Guiana', country: 'France', lat: 4.0, lng: -53.0 },
  { name: 'Quito', country: 'Ecuador', lat: -0.18, lng: -78.47 },
  { name: 'Montevideo', country: 'Uruguay', lat: -34.88, lng: -56.19 },
  { name: 'Brasilia', country: 'Brazil', lat: -15.79, lng: -47.88 },
  { name: 'Recife', country: 'Brazil', lat: -8.05, lng: -34.87 },
  { name: 'Cali', country: 'Colombia', lat: 3.45, lng: -76.53 },
  { name: 'Managua', country: 'Nicaragua', lat: 12.13, lng: -86.25 },
  { name: 'Panama City', country: 'Panama', lat: 8.98, lng: -79.52 },
  { name: 'San Jose', country: 'Costa Rica', lat: 9.93, lng: -84.08 },
  { name: 'Kingston', country: 'Jamaica', lat: 18.0, lng: -76.79 },
  { name: 'Santo Domingo', country: 'Dominican Republic', lat: 18.49, lng: -69.93 },
  { name: 'Asuncion', country: 'Paraguay', lat: -25.26, lng: -57.58 },

  // Oceania
  { name: 'Sydney', country: 'Australia', lat: -33.87, lng: 151.21 },
  { name: 'Melbourne', country: 'Australia', lat: -37.81, lng: 144.96 },
  { name: 'Perth', country: 'Australia', lat: -31.95, lng: 115.86 },
  { name: 'Kimberley', country: 'Australia', lat: -16.4, lng: 126.3 },
  { name: 'Queensland', country: 'Australia', lat: -22.58, lng: 144.09 },
  { name: 'Auckland', country: 'New Zealand', lat: -36.85, lng: 174.76 },
  { name: 'Wellington', country: 'New Zealand', lat: -41.29, lng: 174.78 },
  { name: 'Fiordland', country: 'New Zealand', lat: -45.42, lng: 167.72 },
  { name: 'Suva', country: 'Fiji', lat: -18.14, lng: 178.44 },
  { name: 'Port Moresby', country: 'Papua New Guinea', lat: -6.31, lng: 143.96 },
  { name: 'Brisbane', country: 'Australia', lat: -27.47, lng: 153.03 },
  { name: 'Adelaide', country: 'Australia', lat: -34.93, lng: 138.6 },
  { name: 'Canberra', country: 'Australia', lat: -35.28, lng: 149.13 },
  { name: 'Christchurch', country: 'New Zealand', lat: -43.53, lng: 172.64 },
];

// Country centroids as fallback when no city match is found
const COUNTRY_CENTROIDS = {
  'Afghanistan': [33.9, 67.7], 'Albania': [41.2, 20.2], 'Algeria': [28.0, 1.7],
  'Angola': [-12.3, 17.5], 'Argentina': [-38.4, -63.6], 'Armenia': [40.1, 45.0],
  'Australia': [-25.3, 133.8], 'Austria': [47.5, 14.6], 'Azerbaijan': [40.1, 47.6],
  'Bahrain': [26.0, 50.6], 'Bangladesh': [23.7, 90.4], 'Belarus': [53.7, 27.9],
  'Belgium': [50.8, 4.5], 'Benin': [9.3, 2.3], 'Bolivia': [-16.3, -63.6],
  'Bosnia': [43.9, 17.7], 'Botswana': [-22.3, 24.7], 'Brazil': [-14.2, -51.9],
  'Bulgaria': [42.7, 25.5], 'Burkina Faso': [12.3, -1.6], 'Burundi': [-3.4, 29.9],
  'Cambodia': [12.6, 105.0], 'Cameroon': [7.4, 12.4], 'Canada': [56.1, -106.3],
  'Central African Republic': [6.6, 20.9], 'Chad': [15.5, 18.7], 'Chile': [-35.7, -71.5],
  'China': [35.9, 104.2], 'Colombia': [4.6, -74.3], 'Congo': [-0.2, 15.8],
  'Costa Rica': [9.7, -83.8], 'Croatia': [45.1, 15.2], 'Cuba': [21.5, -78.0],
  'Cyprus': [35.1, 33.4], 'Czech Republic': [49.8, 15.5], 'Dem. Rep. Congo': [-4.0, 21.8],
  'Denmark': [56.3, 9.5], 'Dominican Republic': [18.7, -70.2],
  'Ecuador': [-1.8, -78.2], 'Egypt': [26.8, 30.8], 'El Salvador': [13.8, -88.9],
  'Estonia': [58.6, 25.0], 'Ethiopia': [9.1, 40.5], 'Finland': [61.9, 25.7],
  'France': [46.2, 2.2], 'Gabon': [-0.8, 11.6], 'Georgia': [42.3, 43.4],
  'Germany': [51.2, 10.5], 'Ghana': [7.9, -1.0], 'Greece': [39.1, 21.8],
  'Guatemala': [15.8, -90.2], 'Guinea': [9.9, -11.0], 'Haiti': [19.0, -72.3],
  'Honduras': [15.2, -86.2], 'Hungary': [47.2, 19.5], 'Iceland': [64.9, -19.0],
  'India': [20.6, 78.9], 'Indonesia': [-0.8, 113.9], 'Iran': [32.4, 53.7],
  'Iraq': [33.2, 43.7], 'Ireland': [53.1, -8.0], 'Israel': [31.0, 34.9],
  'Italy': [41.9, 12.6], 'Ivory Coast': [7.5, -5.5], 'Jamaica': [18.1, -77.3],
  'Japan': [36.2, 138.3], 'Jordan': [30.6, 36.2], 'Kazakhstan': [48.0, 68.0],
  'Kenya': [-0.0, 37.9], 'Kuwait': [29.3, 47.5], 'Kyrgyzstan': [41.2, 74.8],
  'Laos': [19.9, 102.5], 'Latvia': [56.9, 24.1], 'Lebanon': [33.9, 35.9],
  'Libya': [26.3, 17.2], 'Lithuania': [55.2, 23.9], 'Luxembourg': [49.8, 6.1],
  'Madagascar': [-18.8, 46.9], 'Malawi': [-13.3, 34.3], 'Malaysia': [4.2, 101.9],
  'Mali': [17.6, -4.0], 'Mauritania': [21.0, -10.9], 'Mexico': [23.6, -102.6],
  'Moldova': [47.4, 28.4], 'Mongolia': [46.9, 103.8], 'Montenegro': [42.7, 19.4],
  'Morocco': [31.8, -7.1], 'Mozambique': [-18.7, 35.5], 'Myanmar': [21.9, 96.0],
  'Namibia': [-22.0, 18.5], 'Nepal': [28.4, 84.1], 'Netherlands': [52.1, 5.3],
  'New Zealand': [-40.9, 174.9], 'Nicaragua': [12.9, -85.2], 'Niger': [17.6, 8.1],
  'Nigeria': [9.1, 8.7], 'North Korea': [40.3, 127.5], 'Norway': [60.5, 8.5],
  'Oman': [21.5, 55.9], 'Pakistan': [30.4, 69.3], 'Palestine': [31.9, 35.2],
  'Panama': [8.5, -80.8], 'Papua New Guinea': [-6.3, 143.9],
  'Paraguay': [-23.4, -58.4], 'Peru': [-9.2, -75.0], 'Philippines': [12.9, 121.8],
  'Poland': [51.9, 19.1], 'Portugal': [39.4, -8.2], 'Qatar': [25.4, 51.2],
  'Romania': [45.9, 25.0], 'Russia': [61.5, 105.3], 'Rwanda': [-1.9, 29.9],
  'Saudi Arabia': [23.9, 45.1], 'Senegal': [14.5, -14.5], 'Serbia': [44.0, 21.0],
  'Sierra Leone': [8.5, -11.8], 'Singapore': [1.4, 103.8], 'Slovakia': [48.7, 19.7],
  'Slovenia': [46.2, 14.8], 'Somalia': [5.2, 46.2], 'South Africa': [-30.6, 22.9],
  'South Korea': [35.9, 128.0], 'South Sudan': [6.9, 31.3], 'Spain': [40.5, -3.7],
  'Sri Lanka': [7.9, 80.8], 'Sudan': [12.9, 30.2], 'Sweden': [60.1, 18.6],
  'Switzerland': [46.8, 8.2], 'Syria': [35.0, 38.5], 'Taiwan': [23.7, 121.0],
  'Tajikistan': [38.9, 71.3], 'Tanzania': [-6.4, 34.9], 'Thailand': [15.9, 100.9],
  'Tunisia': [33.9, 9.5], 'Turkey': [39.0, 35.2], 'Turkmenistan': [38.97, 59.56],
  'Uganda': [1.4, 32.3], 'Ukraine': [48.4, 31.2], 'United Arab Emirates': [23.4, 53.8],
  'United Kingdom': [55.4, -3.4], 'United States': [37.1, -95.7],
  'Uruguay': [-32.5, -55.8], 'Uzbekistan': [41.4, 64.6], 'Venezuela': [6.4, -66.6],
  'Vietnam': [14.1, 108.3], 'Yemen': [15.6, 48.5], 'Zambia': [-13.1, 27.8],
  'Zimbabwe': [-19.0, 29.2]
};

// GDELT sourcecountry codes → country names
const SOURCE_COUNTRY_MAP = {
  'United States': 'United States', 'United Kingdom': 'United Kingdom',
  'India': 'India', 'Australia': 'Australia', 'Canada': 'Canada',
  'Nigeria': 'Nigeria', 'South Africa': 'South Africa', 'Kenya': 'Kenya',
  'Pakistan': 'Pakistan', 'Bangladesh': 'Bangladesh', 'Philippines': 'Philippines',
  'Germany': 'Germany', 'France': 'France', 'Italy': 'Italy', 'Spain': 'Spain',
  'Japan': 'Japan', 'China': 'China', 'Brazil': 'Brazil', 'Mexico': 'Mexico',
  'Russia': 'Russia', 'Turkey': 'Turkey', 'Indonesia': 'Indonesia',
  'Egypt': 'Egypt', 'Thailand': 'Thailand', 'Ukraine': 'Ukraine',
  'Israel': 'Israel', 'Iran': 'Iran', 'Iraq': 'Iraq', 'Colombia': 'Colombia',
  'Argentina': 'Argentina', 'Peru': 'Peru', 'Chile': 'Chile',
  'Saudi Arabia': 'Saudi Arabia', 'Singapore': 'Singapore', 'Malaysia': 'Malaysia',
  'Vietnam': 'Vietnam', 'Poland': 'Poland', 'Netherlands': 'Netherlands',
  'Sweden': 'Sweden', 'Norway': 'Norway', 'Switzerland': 'Switzerland',
  'Belgium': 'Belgium', 'Austria': 'Austria', 'Denmark': 'Denmark',
  'Finland': 'Finland', 'Ireland': 'Ireland', 'Greece': 'Greece',
  'Portugal': 'Portugal', 'Czech Republic': 'Czech Republic',
  'Romania': 'Romania', 'Hungary': 'Hungary', 'New Zealand': 'New Zealand',
};

// Build a search index: lowercase name → location entry
const locationIndex = new Map();
LOCATIONS.forEach((loc) => {
  locationIndex.set(loc.name.toLowerCase(), loc);
});

/**
 * Attempt to geocode an article from its title and source country.
 * Returns { lat, lng, locality, region } or null.
 */
export function geocodeArticle(title, sourcecountry) {
  const titleLower = (title || '').toLowerCase();

  // 1. Try to find a known city/region in the title
  let bestMatch = null;
  let bestPos = Infinity;

  for (const [name, loc] of locationIndex) {
    const idx = titleLower.indexOf(name);
    if (idx !== -1 && idx < bestPos) {
      // Prefer longer matches (e.g. "New York" over "York")
      if (!bestMatch || name.length > bestMatch.name.toLowerCase().length) {
        bestMatch = loc;
        bestPos = idx;
      }
    }
  }

  if (bestMatch) {
    return {
      lat: bestMatch.lat,
      lng: bestMatch.lng,
      locality: bestMatch.name,
      region: bestMatch.country
    };
  }

  // 2. Try country name from sourcecountry field
  const countryName = SOURCE_COUNTRY_MAP[sourcecountry] || sourcecountry;

  // Check if country name appears in the title to confirm relevance
  const coords = COUNTRY_CENTROIDS[countryName];
  if (coords) {
    return {
      lat: coords[0],
      lng: coords[1],
      locality: countryName,
      region: countryName
    };
  }

  // 3. Try to match any country name in the title
  for (const [country, centroid] of Object.entries(COUNTRY_CENTROIDS)) {
    if (titleLower.includes(country.toLowerCase())) {
      return {
        lat: centroid[0],
        lng: centroid[1],
        locality: country,
        region: country
      };
    }
  }

  return null;
}

/**
 * Get ISO A2 code for a country name (best-effort mapping).
 */
const COUNTRY_TO_ISO = {
  'Afghanistan': 'AF', 'Albania': 'AL', 'Algeria': 'DZ', 'Angola': 'AO',
  'Argentina': 'AR', 'Armenia': 'AM', 'Australia': 'AU', 'Austria': 'AT',
  'Azerbaijan': 'AZ', 'Bangladesh': 'BD', 'Belarus': 'BY', 'Belgium': 'BE',
  'Bolivia': 'BO', 'Bosnia': 'BA', 'Botswana': 'BW', 'Brazil': 'BR',
  'Bulgaria': 'BG', 'Burkina Faso': 'BF', 'Cambodia': 'KH', 'Cameroon': 'CM',
  'Canada': 'CA', 'Chad': 'TD', 'Chile': 'CL', 'China': 'CN',
  'Colombia': 'CO', 'Costa Rica': 'CR', 'Croatia': 'HR', 'Cuba': 'CU',
  'Cyprus': 'CY', 'Czech Republic': 'CZ', 'Dem. Rep. Congo': 'CD',
  'Denmark': 'DK', 'Ecuador': 'EC', 'Egypt': 'EG', 'El Salvador': 'SV',
  'Estonia': 'EE', 'Ethiopia': 'ET', 'Finland': 'FI', 'France': 'FR',
  'Gabon': 'GA', 'Georgia': 'GE', 'Germany': 'DE', 'Ghana': 'GH',
  'Greece': 'GR', 'Guatemala': 'GT', 'Guinea': 'GN', 'Haiti': 'HT',
  'Honduras': 'HN', 'Hungary': 'HU', 'Iceland': 'IS', 'India': 'IN',
  'Indonesia': 'ID', 'Iran': 'IR', 'Iraq': 'IQ', 'Ireland': 'IE',
  'Israel': 'IL', 'Italy': 'IT', 'Jamaica': 'JM', 'Japan': 'JP',
  'Jordan': 'JO', 'Kazakhstan': 'KZ', 'Kenya': 'KE', 'Kuwait': 'KW',
  'Laos': 'LA', 'Latvia': 'LV', 'Lebanon': 'LB', 'Libya': 'LY',
  'Lithuania': 'LT', 'Luxembourg': 'LU', 'Madagascar': 'MG', 'Malaysia': 'MY',
  'Mali': 'ML', 'Mexico': 'MX', 'Moldova': 'MD', 'Mongolia': 'MN',
  'Montenegro': 'ME', 'Morocco': 'MA', 'Mozambique': 'MZ', 'Myanmar': 'MM',
  'Nepal': 'NP', 'Netherlands': 'NL', 'New Zealand': 'NZ', 'Nicaragua': 'NI',
  'Niger': 'NE', 'Nigeria': 'NG', 'North Korea': 'KP', 'Norway': 'NO',
  'Oman': 'OM', 'Pakistan': 'PK', 'Palestine': 'PS', 'Panama': 'PA',
  'Paraguay': 'PY', 'Peru': 'PE', 'Philippines': 'PH', 'Poland': 'PL',
  'Portugal': 'PT', 'Qatar': 'QA', 'Romania': 'RO', 'Russia': 'RU',
  'Rwanda': 'RW', 'Saudi Arabia': 'SA', 'Senegal': 'SN', 'Serbia': 'RS',
  'Singapore': 'SG', 'Slovakia': 'SK', 'Slovenia': 'SI', 'Somalia': 'SO',
  'South Africa': 'ZA', 'South Korea': 'KR', 'South Sudan': 'SS',
  'Spain': 'ES', 'Sri Lanka': 'LK', 'Sudan': 'SD', 'Sweden': 'SE',
  'Switzerland': 'CH', 'Syria': 'SY', 'Taiwan': 'TW', 'Tanzania': 'TZ',
  'Thailand': 'TH', 'Tunisia': 'TN', 'Turkey': 'TR', 'Uganda': 'UG',
  'Ukraine': 'UA', 'United Arab Emirates': 'AE', 'United Kingdom': 'GB',
  'United States': 'US', 'Uruguay': 'UY', 'Venezuela': 'VE',
  'Vietnam': 'VN', 'Yemen': 'YE', 'Zambia': 'ZM', 'Zimbabwe': 'ZW'
};

export function countryToIso(countryName) {
  return COUNTRY_TO_ISO[countryName] || null;
}
