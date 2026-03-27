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
  { name: "N'Djamena", country: 'Chad', lat: 12.13, lng: 15.05 },
  { name: 'Conakry', country: 'Guinea', lat: 9.64, lng: -13.58 },
  { name: 'Ouagadougou', country: 'Burkina Faso', lat: 12.37, lng: -1.52 },
  { name: 'Niamey', country: 'Niger', lat: 13.51, lng: 2.11 },
  { name: 'Cotonou', country: 'Benin', lat: 6.37, lng: 2.39 },
  { name: 'Porto-Novo', country: 'Benin', lat: 6.50, lng: 2.60 },
  // Additional Africa
  { name: 'Asmara', country: 'Eritrea', lat: 15.34, lng: 38.93 },
  { name: 'Djibouti', country: 'Djibouti', lat: 11.59, lng: 43.15 },
  { name: 'Moroni', country: 'Comoros', lat: -11.70, lng: 43.26 },
  { name: 'Port Louis', country: 'Mauritius', lat: -20.16, lng: 57.50 },
  { name: 'Victoria', country: 'Seychelles', lat: -4.62, lng: 55.45 },
  { name: 'Praia', country: 'Cabo Verde', lat: 14.93, lng: -23.51 },
  { name: 'Banjul', country: 'Gambia', lat: 13.45, lng: -16.58 },
  { name: 'Bissau', country: 'Guinea-Bissau', lat: 11.86, lng: -15.60 },
  { name: 'Lome', country: 'Togo', lat: 6.17, lng: 1.23 },
  { name: 'Monrovia', country: 'Liberia', lat: 6.30, lng: -10.80 },
  { name: 'Malabo', country: 'Equatorial Guinea', lat: 3.75, lng: 8.78 },
  { name: 'Sao Tome', country: 'Sao Tome and Principe', lat: 0.34, lng: 6.73 },
  { name: 'Brazzaville', country: 'Congo', lat: -4.27, lng: 15.28 },
  { name: 'Bangui', country: 'Central African Republic', lat: 4.36, lng: 18.56 },
  { name: 'Gitega', country: 'Burundi', lat: -3.43, lng: 29.93 },
  { name: 'Bujumbura', country: 'Burundi', lat: -3.38, lng: 29.36 },
  { name: 'Mbabane', country: 'Eswatini', lat: -26.31, lng: 31.14 },
  { name: 'Maseru', country: 'Lesotho', lat: -29.31, lng: 27.48 },
  { name: 'Nouakchott', country: 'Mauritania', lat: 18.09, lng: -15.98 },
  { name: 'Pretoria', country: 'South Africa', lat: -25.75, lng: 28.19 },
  { name: 'Bloemfontein', country: 'South Africa', lat: -29.12, lng: 26.21 },
  { name: 'Rabat', country: 'Morocco', lat: 34.02, lng: -6.84 },
  { name: 'Marrakech', country: 'Morocco', lat: 31.63, lng: -8.01 },
  { name: 'Fez', country: 'Morocco', lat: 34.03, lng: -5.00 },
  { name: 'Oran', country: 'Algeria', lat: 35.70, lng: -0.63 },
  { name: 'Constantine', country: 'Algeria', lat: 36.37, lng: 6.61 },
  { name: 'Sfax', country: 'Tunisia', lat: 34.74, lng: 10.76 },
  { name: 'Sirte', country: 'Libya', lat: 31.21, lng: 16.59 },
  { name: 'Omdurman', country: 'Sudan', lat: 15.64, lng: 32.48 },
  { name: 'Luxor', country: 'Egypt', lat: 25.69, lng: 32.64 },
  { name: 'Aswan', country: 'Egypt', lat: 24.09, lng: 32.90 },
  { name: 'Nakuru', country: 'Kenya', lat: -0.30, lng: 36.07 },
  { name: 'Kisumu', country: 'Kenya', lat: -0.09, lng: 34.77 },
  { name: 'Zanzibar', country: 'Tanzania', lat: -6.17, lng: 39.19 },
  { name: 'Arusha', country: 'Tanzania', lat: -3.39, lng: 36.68 },
  { name: 'Dire Dawa', country: 'Ethiopia', lat: 9.60, lng: 41.85 },
  { name: 'Bahir Dar', country: 'Ethiopia', lat: 11.59, lng: 37.39 },
  { name: 'Gulu', country: 'Uganda', lat: 2.77, lng: 32.30 },
  { name: 'Lubumbashi', country: 'Dem. Rep. Congo', lat: -11.66, lng: 27.48 },
  { name: 'Bukavu', country: 'Dem. Rep. Congo', lat: -2.51, lng: 28.86 },
  { name: 'Kisangani', country: 'Dem. Rep. Congo', lat: 0.52, lng: 25.19 },
  { name: 'Kumasi', country: 'Ghana', lat: 6.69, lng: -1.62 },
  { name: 'Tamale', country: 'Ghana', lat: 9.40, lng: -0.84 },
  { name: 'Timbuktu', country: 'Mali', lat: 16.77, lng: -3.01 },
  { name: 'Gao', country: 'Mali', lat: 16.27, lng: -0.04 },
  { name: 'Agadez', country: 'Niger', lat: 16.97, lng: 7.99 },
  { name: 'Zinder', country: 'Niger', lat: 13.80, lng: 8.99 },
  { name: 'Bobo-Dioulasso', country: 'Burkina Faso', lat: 11.18, lng: -4.30 },
  { name: 'Bamenda', country: 'Cameroon', lat: 5.96, lng: 10.15 },
  { name: 'Garoua', country: 'Cameroon', lat: 9.30, lng: 13.40 },
  { name: 'Beira', country: 'Mozambique', lat: -19.84, lng: 34.87 },
  { name: 'Nampula', country: 'Mozambique', lat: -15.12, lng: 39.27 },
  { name: 'Hargeisa', country: 'Somalia', lat: 9.56, lng: 44.06 },
  { name: 'Kismayo', country: 'Somalia', lat: -0.35, lng: 42.54 },
  { name: 'Malakal', country: 'South Sudan', lat: 9.53, lng: 31.66 },
  { name: 'Wau', country: 'South Sudan', lat: 7.70, lng: 28.00 },
  { name: 'Saint-Louis', country: 'Senegal', lat: 16.02, lng: -16.50 },
  { name: 'Benin City', country: 'Nigeria', lat: 6.34, lng: 5.63 },
  { name: 'Sokoto', country: 'Nigeria', lat: 13.06, lng: 5.24 },
  { name: 'Bulawayo', country: 'Zimbabwe', lat: -20.15, lng: 28.58 },

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
  // Additional Middle East
  { name: 'Najaf', country: 'Iraq', lat: 32.00, lng: 44.34 },
  { name: 'Kirkuk', country: 'Iraq', lat: 35.47, lng: 44.39 },
  { name: 'Homs', country: 'Syria', lat: 34.73, lng: 36.71 },
  { name: 'Raqqa', country: 'Syria', lat: 35.95, lng: 39.01 },
  { name: 'Deir ez-Zor', country: 'Syria', lat: 35.34, lng: 40.14 },
  { name: 'Mashhad', country: 'Iran', lat: 36.30, lng: 59.60 },
  { name: 'Shiraz', country: 'Iran', lat: 29.59, lng: 52.58 },
  { name: 'Ahvaz', country: 'Iran', lat: 31.32, lng: 48.69 },
  { name: 'Mecca', country: 'Saudi Arabia', lat: 21.43, lng: 39.83 },
  { name: 'Medina', country: 'Saudi Arabia', lat: 24.47, lng: 39.61 },
  { name: 'Sharjah', country: 'United Arab Emirates', lat: 25.36, lng: 55.39 },
  { name: 'Taiz', country: 'Yemen', lat: 13.58, lng: 44.02 },
  { name: 'Hodeidah', country: 'Yemen', lat: 14.80, lng: 42.95 },
  { name: 'Herat', country: 'Afghanistan', lat: 34.34, lng: 62.20 },
  { name: 'Mazar-i-Sharif', country: 'Afghanistan', lat: 36.71, lng: 67.11 },
  { name: 'Jalalabad', country: 'Afghanistan', lat: 34.43, lng: 70.45 },
  { name: 'Tripoli', country: 'Lebanon', lat: 34.44, lng: 35.83 },
  { name: 'Sidon', country: 'Lebanon', lat: 33.56, lng: 35.37 },

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
  // Additional Europe
  { name: 'Zagreb', country: 'Croatia', lat: 45.81, lng: 15.98 },
  { name: 'Sofia', country: 'Bulgaria', lat: 42.70, lng: 23.32 },
  { name: 'Skopje', country: 'North Macedonia', lat: 42.00, lng: 21.43 },
  { name: 'Pristina', country: 'Kosovo', lat: 42.66, lng: 21.17 },
  { name: 'Podgorica', country: 'Montenegro', lat: 42.44, lng: 19.26 },
  { name: 'Tirana', country: 'Albania', lat: 41.33, lng: 19.82 },
  { name: 'Luxembourg City', country: 'Luxembourg', lat: 49.61, lng: 6.13 },
  { name: 'Valletta', country: 'Malta', lat: 35.90, lng: 14.51 },
  { name: 'Nicosia', country: 'Cyprus', lat: 35.17, lng: 33.36 },
  { name: 'Minsk', country: 'Belarus', lat: 53.90, lng: 27.57 },
  { name: 'Sarajevo', country: 'Bosnia', lat: 43.86, lng: 18.41 },
  { name: 'Andorra la Vella', country: 'Andorra', lat: 42.51, lng: 1.52 },
  { name: 'Novosibirsk', country: 'Russia', lat: 55.04, lng: 82.93 },
  { name: 'Yekaterinburg', country: 'Russia', lat: 56.84, lng: 60.60 },
  { name: 'Kazan', country: 'Russia', lat: 55.80, lng: 49.11 },
  { name: 'Rostov-on-Don', country: 'Russia', lat: 47.24, lng: 39.71 },
  { name: 'Vladivostok', country: 'Russia', lat: 43.12, lng: 131.89 },
  { name: 'Murmansk', country: 'Russia', lat: 68.97, lng: 33.07 },
  { name: 'Sochi', country: 'Russia', lat: 43.60, lng: 39.73 },
  { name: 'Kaliningrad', country: 'Russia', lat: 54.71, lng: 20.51 },
  { name: 'Volgograd', country: 'Russia', lat: 48.71, lng: 44.50 },
  { name: 'Chelyabinsk', country: 'Russia', lat: 55.15, lng: 61.43 },
  { name: 'Dnipro', country: 'Ukraine', lat: 48.46, lng: 35.05 },
  { name: 'Donetsk', country: 'Ukraine', lat: 48.00, lng: 37.80 },
  { name: 'Mariupol', country: 'Ukraine', lat: 47.10, lng: 37.55 },
  { name: 'Lviv', country: 'Ukraine', lat: 49.84, lng: 24.03 },
  { name: 'Sumy', country: 'Ukraine', lat: 50.91, lng: 34.80 },
  { name: 'Cluj-Napoca', country: 'Romania', lat: 46.77, lng: 23.60 },
  { name: 'Timisoara', country: 'Romania', lat: 45.76, lng: 21.23 },
  { name: 'Krakow', country: 'Poland', lat: 50.06, lng: 19.94 },
  { name: 'Gdansk', country: 'Poland', lat: 54.35, lng: 18.65 },
  { name: 'Wroclaw', country: 'Poland', lat: 51.11, lng: 17.04 },
  { name: 'Frankfurt', country: 'Germany', lat: 50.11, lng: 8.68 },
  { name: 'Cologne', country: 'Germany', lat: 50.94, lng: 6.96 },
  { name: 'Dresden', country: 'Germany', lat: 51.05, lng: 13.74 },
  { name: 'Turin', country: 'Italy', lat: 45.07, lng: 7.69 },
  { name: 'Palermo', country: 'Italy', lat: 38.12, lng: 13.36 },
  { name: 'Florence', country: 'Italy', lat: 43.77, lng: 11.25 },
  { name: 'Seville', country: 'Spain', lat: 37.39, lng: -5.98 },
  { name: 'Valencia', country: 'Spain', lat: 39.47, lng: -0.38 },
  { name: 'Bilbao', country: 'Spain', lat: 43.26, lng: -2.93 },
  { name: 'Toulouse', country: 'France', lat: 43.60, lng: 1.44 },
  { name: 'Nice', country: 'France', lat: 43.71, lng: 7.26 },
  { name: 'Strasbourg', country: 'France', lat: 48.58, lng: 7.75 },
  { name: 'Belfast', country: 'United Kingdom', lat: 54.60, lng: -5.93 },
  { name: 'Cardiff', country: 'United Kingdom', lat: 51.48, lng: -3.18 },
  { name: 'Birmingham', country: 'United Kingdom', lat: 52.49, lng: -1.90 },
  { name: 'Glasgow', country: 'United Kingdom', lat: 55.86, lng: -4.25 },
  { name: 'Gothenburg', country: 'Sweden', lat: 57.71, lng: 11.97 },
  { name: 'Bergen', country: 'Norway', lat: 60.39, lng: 5.32 },
  { name: 'Thessaloniki', country: 'Greece', lat: 40.64, lng: 22.94 },
  { name: 'Porto', country: 'Portugal', lat: 41.16, lng: -8.63 },
  { name: 'Diyarbakir', country: 'Turkey', lat: 37.91, lng: 40.22 },
  { name: 'Gaziantep', country: 'Turkey', lat: 37.07, lng: 37.38 },
  { name: 'Adana', country: 'Turkey', lat: 37.00, lng: 35.33 },
  { name: 'Split', country: 'Croatia', lat: 43.51, lng: 16.44 },
  { name: 'Dubrovnik', country: 'Croatia', lat: 42.65, lng: 18.09 },
  { name: 'Plovdiv', country: 'Bulgaria', lat: 42.15, lng: 24.75 },
  { name: 'Varna', country: 'Bulgaria', lat: 43.21, lng: 27.91 },
  { name: 'Novi Sad', country: 'Serbia', lat: 45.25, lng: 19.85 },
  { name: 'Gomel', country: 'Belarus', lat: 52.44, lng: 30.99 },
  { name: 'Tiraspol', country: 'Moldova', lat: 46.84, lng: 29.63 },
  { name: 'Batumi', country: 'Georgia', lat: 41.64, lng: 41.64 },
  { name: 'Kutaisi', country: 'Georgia', lat: 42.27, lng: 42.69 },
  { name: 'Baku', country: 'Azerbaijan', lat: 40.41, lng: 49.87 },
  { name: 'Yerevan', country: 'Armenia', lat: 40.18, lng: 44.51 },

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
  // Additional Asia
  { name: 'Bandar Seri Begawan', country: 'Brunei', lat: 4.94, lng: 114.95 },
  { name: 'Dili', country: 'Timor-Leste', lat: -8.56, lng: 125.57 },
  { name: 'Thimphu', country: 'Bhutan', lat: 27.47, lng: 89.64 },
  { name: 'Male', country: 'Maldives', lat: 4.18, lng: 73.51 },
  { name: 'Ashgabat', country: 'Turkmenistan', lat: 37.96, lng: 58.38 },
  { name: 'Dushanbe', country: 'Tajikistan', lat: 38.56, lng: 68.77 },
  { name: 'Bishkek', country: 'Kyrgyzstan', lat: 42.87, lng: 74.59 },
  { name: 'Pyongyang', country: 'North Korea', lat: 39.02, lng: 125.75 },
  { name: 'Astana', country: 'Kazakhstan', lat: 51.17, lng: 71.45 },
  { name: 'Guangzhou', country: 'China', lat: 23.13, lng: 113.26 },
  { name: 'Shenzhen', country: 'China', lat: 22.54, lng: 114.06 },
  { name: 'Chengdu', country: 'China', lat: 30.57, lng: 104.07 },
  { name: 'Wuhan', country: 'China', lat: 30.59, lng: 114.31 },
  { name: 'Nanjing', country: 'China', lat: 32.06, lng: 118.80 },
  { name: 'Hangzhou', country: 'China', lat: 30.27, lng: 120.15 },
  { name: 'Chongqing', country: 'China', lat: 29.56, lng: 106.55 },
  { name: 'Tianjin', country: 'China', lat: 39.13, lng: 117.20 },
  { name: 'Harbin', country: 'China', lat: 45.75, lng: 126.65 },
  { name: 'Kunming', country: 'China', lat: 25.04, lng: 102.71 },
  { name: 'Urumqi', country: 'China', lat: 43.80, lng: 87.60 },
  { name: 'Lhasa', country: 'China', lat: 29.65, lng: 91.10 },
  { name: 'Surat', country: 'India', lat: 21.17, lng: 72.83 },
  { name: 'Patna', country: 'India', lat: 25.60, lng: 85.10 },
  { name: 'Chandigarh', country: 'India', lat: 30.73, lng: 76.78 },
  { name: 'Bhopal', country: 'India', lat: 23.26, lng: 77.41 },
  { name: 'Kochi', country: 'India', lat: 9.93, lng: 76.27 },
  { name: 'Guwahati', country: 'India', lat: 26.14, lng: 91.74 },
  { name: 'Srinagar', country: 'India', lat: 34.08, lng: 74.80 },
  { name: 'Imphal', country: 'India', lat: 24.82, lng: 93.95 },
  { name: 'Nagoya', country: 'Japan', lat: 35.18, lng: 136.91 },
  { name: 'Fukuoka', country: 'Japan', lat: 33.59, lng: 130.40 },
  { name: 'Sapporo', country: 'Japan', lat: 43.06, lng: 141.35 },
  { name: 'Hiroshima', country: 'Japan', lat: 34.39, lng: 132.46 },
  { name: 'Busan', country: 'South Korea', lat: 35.18, lng: 129.08 },
  { name: 'Incheon', country: 'South Korea', lat: 37.46, lng: 126.71 },
  { name: 'Peshawar', country: 'Pakistan', lat: 34.02, lng: 71.58 },
  { name: 'Quetta', country: 'Pakistan', lat: 30.18, lng: 67.01 },
  { name: 'Faisalabad', country: 'Pakistan', lat: 31.42, lng: 73.08 },
  { name: 'Chittagong', country: 'Bangladesh', lat: 22.34, lng: 91.83 },
  { name: 'Sylhet', country: 'Bangladesh', lat: 24.90, lng: 91.87 },
  { name: 'Phuket', country: 'Thailand', lat: 7.88, lng: 98.39 },
  { name: 'Surabaya', country: 'Indonesia', lat: -7.25, lng: 112.75 },
  { name: 'Bandung', country: 'Indonesia', lat: -6.91, lng: 107.61 },
  { name: 'Medan', country: 'Indonesia', lat: 3.60, lng: 98.67 },
  { name: 'Bali', country: 'Indonesia', lat: -8.34, lng: 115.09 },
  { name: 'Makassar', country: 'Indonesia', lat: -5.14, lng: 119.42 },
  { name: 'Aceh', country: 'Indonesia', lat: 5.55, lng: 95.32 },
  { name: 'Zamboanga', country: 'Philippines', lat: 6.91, lng: 122.07 },
  { name: 'Da Nang', country: 'Vietnam', lat: 16.05, lng: 108.22 },
  { name: 'Hue', country: 'Vietnam', lat: 16.46, lng: 107.60 },
  { name: 'Mandalay', country: 'Myanmar', lat: 21.97, lng: 96.08 },
  { name: 'Naypyidaw', country: 'Myanmar', lat: 19.76, lng: 96.07 },
  { name: 'Siem Reap', country: 'Cambodia', lat: 13.36, lng: 103.86 },
  { name: 'Penang', country: 'Malaysia', lat: 5.42, lng: 100.33 },
  { name: 'Johor Bahru', country: 'Malaysia', lat: 1.49, lng: 103.74 },
  { name: 'Samarkand', country: 'Uzbekistan', lat: 39.65, lng: 66.96 },
  { name: 'Bukhara', country: 'Uzbekistan', lat: 39.77, lng: 64.42 },
  { name: 'Kandy', country: 'Sri Lanka', lat: 7.29, lng: 80.64 },
  { name: 'Jaffna', country: 'Sri Lanka', lat: 9.66, lng: 80.02 },
  { name: 'Osh', country: 'Kyrgyzstan', lat: 40.53, lng: 72.80 },
  { name: 'Khujand', country: 'Tajikistan', lat: 40.28, lng: 69.62 },

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
  // Additional Americas
  { name: 'La Paz', country: 'Bolivia', lat: -16.50, lng: -68.15 },
  { name: 'Sucre', country: 'Bolivia', lat: -19.04, lng: -65.26 },
  { name: 'Georgetown', country: 'Guyana', lat: 6.80, lng: -58.16 },
  { name: 'Paramaribo', country: 'Suriname', lat: 5.85, lng: -55.20 },
  { name: 'Belmopan', country: 'Belize', lat: 17.25, lng: -88.77 },
  { name: 'Nassau', country: 'Bahamas', lat: 25.05, lng: -77.34 },
  { name: 'Bridgetown', country: 'Barbados', lat: 13.10, lng: -59.61 },
  { name: 'St Georges', country: 'Grenada', lat: 12.05, lng: -61.75 },
  { name: 'Castries', country: 'Saint Lucia', lat: 14.01, lng: -60.99 },
  { name: 'Basseterre', country: 'Saint Kitts and Nevis', lat: 17.30, lng: -62.72 },
  { name: 'Roseau', country: 'Dominica', lat: 15.30, lng: -61.39 },
  { name: 'Kingstown', country: 'Saint Vincent and the Grenadines', lat: 13.16, lng: -61.23 },
  { name: 'St Johns', country: 'Antigua and Barbuda', lat: 17.12, lng: -61.85 },
  { name: 'Denver', country: 'United States', lat: 39.74, lng: -104.99 },
  { name: 'Phoenix', country: 'United States', lat: 33.45, lng: -112.07 },
  { name: 'Atlanta', country: 'United States', lat: 33.75, lng: -84.39 },
  { name: 'Boston', country: 'United States', lat: 42.36, lng: -71.06 },
  { name: 'Philadelphia', country: 'United States', lat: 39.95, lng: -75.17 },
  { name: 'Dallas', country: 'United States', lat: 32.78, lng: -96.80 },
  { name: 'Las Vegas', country: 'United States', lat: 36.17, lng: -115.14 },
  { name: 'New Orleans', country: 'United States', lat: 29.95, lng: -90.07 },
  { name: 'Montreal', country: 'Canada', lat: 45.50, lng: -73.57 },
  { name: 'Calgary', country: 'Canada', lat: 51.05, lng: -114.07 },
  { name: 'Edmonton', country: 'Canada', lat: 53.55, lng: -113.49 },
  { name: 'Monterrey', country: 'Mexico', lat: 25.67, lng: -100.31 },
  { name: 'Cancun', country: 'Mexico', lat: 21.16, lng: -86.85 },
  { name: 'Puebla', country: 'Mexico', lat: 19.04, lng: -98.20 },
  { name: 'Belo Horizonte', country: 'Brazil', lat: -19.92, lng: -43.94 },
  { name: 'Curitiba', country: 'Brazil', lat: -25.43, lng: -49.27 },
  { name: 'Porto Alegre', country: 'Brazil', lat: -30.03, lng: -51.23 },
  { name: 'Salvador', country: 'Brazil', lat: -12.97, lng: -38.51 },
  { name: 'Fortaleza', country: 'Brazil', lat: -3.72, lng: -38.53 },
  { name: 'Manaus', country: 'Brazil', lat: -3.12, lng: -60.02 },
  { name: 'Cordoba', country: 'Argentina', lat: -31.42, lng: -64.18 },
  { name: 'Rosario', country: 'Argentina', lat: -32.95, lng: -60.65 },
  { name: 'Mendoza', country: 'Argentina', lat: -32.89, lng: -68.83 },
  { name: 'Barranquilla', country: 'Colombia', lat: 10.96, lng: -74.78 },
  { name: 'Cartagena', country: 'Colombia', lat: 10.39, lng: -75.51 },
  { name: 'Arequipa', country: 'Peru', lat: -16.41, lng: -71.54 },
  { name: 'Cusco', country: 'Peru', lat: -13.53, lng: -71.97 },
  { name: 'Trujillo', country: 'Peru', lat: -8.11, lng: -79.04 },
  { name: 'Valparaiso', country: 'Chile', lat: -33.05, lng: -71.62 },
  { name: 'Concepcion', country: 'Chile', lat: -36.83, lng: -73.05 },
  { name: 'Maracaibo', country: 'Venezuela', lat: 10.63, lng: -71.63 },
  { name: 'Guayaquil', country: 'Ecuador', lat: -2.19, lng: -79.89 },
  { name: 'Cuenca', country: 'Ecuador', lat: -2.90, lng: -79.00 },
  { name: 'Ciudad del Este', country: 'Paraguay', lat: -25.51, lng: -54.61 },
  { name: 'Santa Cruz', country: 'Bolivia', lat: -17.78, lng: -63.18 },
  { name: 'Belize City', country: 'Belize', lat: 17.50, lng: -88.20 },

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

  // Additional Oceania
  { name: 'Apia', country: 'Samoa', lat: -13.83, lng: -171.76 },
  { name: 'Nukualofa', country: 'Tonga', lat: -21.21, lng: -175.20 },
  { name: 'Honiara', country: 'Solomon Islands', lat: -9.43, lng: 160.04 },
  { name: 'Port Vila', country: 'Vanuatu', lat: -17.73, lng: 168.32 },
  { name: 'Tarawa', country: 'Kiribati', lat: 1.45, lng: 173.00 },
  { name: 'Palikir', country: 'Micronesia', lat: 6.91, lng: 158.16 },
  { name: 'Majuro', country: 'Marshall Islands', lat: 7.09, lng: 171.38 },
  { name: 'Ngerulmud', country: 'Palau', lat: 7.50, lng: 134.62 },
  { name: 'Funafuti', country: 'Tuvalu', lat: -8.52, lng: 179.20 },
  { name: 'Darwin', country: 'Australia', lat: -12.46, lng: 130.84 },
  { name: 'Hobart', country: 'Australia', lat: -42.88, lng: 147.33 },
  { name: 'Noumea', country: 'New Caledonia', lat: -22.28, lng: 166.46 },
  { name: 'Papeete', country: 'French Polynesia', lat: -17.53, lng: -149.57 },

  // Caribbean
  { name: 'Port of Spain', country: 'Trinidad and Tobago', lat: 10.66, lng: -61.51 },
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
  'Zimbabwe': [-19.0, 29.2],
  'Fiji': [-17.7, 178.0], 'Trinidad and Tobago': [10.5, -61.3],
  'Eritrea': [15.2, 39.8], 'Djibouti': [11.8, 42.6], 'Comoros': [-12.2, 44.3],
  'Mauritius': [-20.3, 57.6], 'Seychelles': [-4.7, 55.5], 'Cabo Verde': [16.0, -24.0],
  'Gambia': [13.4, -15.3], 'Guinea-Bissau': [12.0, -15.2], 'Togo': [8.6, 1.2],
  'Liberia': [6.4, -9.4], 'Equatorial Guinea': [1.6, 10.3],
  'Sao Tome and Principe': [0.2, 6.6], 'Burundi': [-3.4, 29.9],
  'Eswatini': [-26.5, 31.5], 'Lesotho': [-29.6, 28.2],
  'Brunei': [4.5, 114.7], 'Timor-Leste': [-8.9, 125.7],
  'Bhutan': [27.5, 90.4], 'Maldives': [3.2, 73.2],
  'Croatia': [45.1, 15.2], 'Bulgaria': [42.7, 25.5],
  'North Macedonia': [41.5, 21.7], 'Kosovo': [42.6, 20.9],
  'Malta': [35.9, 14.4], 'Andorra': [42.5, 1.5],
  'Bahamas': [25.0, -77.4], 'Barbados': [13.2, -59.5],
  'Grenada': [12.1, -61.7], 'Saint Lucia': [13.9, -61.0],
  'Saint Kitts and Nevis': [17.3, -62.7], 'Dominica': [15.4, -61.4],
  'Saint Vincent and the Grenadines': [13.2, -61.2], 'Antigua and Barbuda': [17.1, -61.8],
  'Guyana': [5.0, -59.0], 'Suriname': [4.0, -56.0], 'Belize': [17.2, -88.5],
  'Bolivia': [-16.3, -63.6],
  'Samoa': [-13.8, -172.1], 'Tonga': [-21.2, -175.2],
  'Solomon Islands': [-9.4, 160.0], 'Vanuatu': [-17.7, 168.3],
  'Kiribati': [1.9, -157.5], 'Micronesia': [7.4, 150.6],
  'Marshall Islands': [7.1, 171.2], 'Palau': [7.5, 134.6],
  'Tuvalu': [-8.5, 179.2], 'Nauru': [-0.5, 166.9],
  'New Caledonia': [-20.9, 165.6], 'French Polynesia': [-17.7, -149.4],
  'Armenia': [40.1, 45.0], 'Azerbaijan': [40.1, 47.6]
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
  'Croatia': 'Croatia', 'Bulgaria': 'Bulgaria', 'Serbia': 'Serbia',
  'Slovakia': 'Slovakia', 'Slovenia': 'Slovenia', 'Lithuania': 'Lithuania',
  'Latvia': 'Latvia', 'Estonia': 'Estonia', 'Georgia': 'Georgia',
  'Armenia': 'Armenia', 'Azerbaijan': 'Azerbaijan', 'Kazakhstan': 'Kazakhstan',
  'Uzbekistan': 'Uzbekistan', 'Kenya': 'Kenya', 'Ethiopia': 'Ethiopia',
  'Ghana': 'Ghana', 'Tanzania': 'Tanzania', 'Uganda': 'Uganda',
  'Cameroon': 'Cameroon', 'Senegal': 'Senegal', 'Morocco': 'Morocco',
  'Tunisia': 'Tunisia', 'Algeria': 'Algeria', 'Bangladesh': 'Bangladesh',
  'Sri Lanka': 'Sri Lanka', 'Myanmar': 'Myanmar', 'Cambodia': 'Cambodia',
  'Nepal': 'Nepal', 'Cuba': 'Cuba', 'Jamaica': 'Jamaica',
  'Dominican Republic': 'Dominican Republic', 'Guatemala': 'Guatemala',
  'Honduras': 'Honduras', 'El Salvador': 'El Salvador',
  'Costa Rica': 'Costa Rica', 'Panama': 'Panama', 'Ecuador': 'Ecuador',
  'Bolivia': 'Bolivia', 'Paraguay': 'Paraguay', 'Uruguay': 'Uruguay',
  'Venezuela': 'Venezuela', 'Fiji': 'Fiji',
  'Papua New Guinea': 'Papua New Guinea', 'Mongolia': 'Mongolia',
};

const COUNTRY_ALIASES = {
  'Czech Republic': ['czechia', 'czech'],
  'Dem. Rep. Congo': ['democratic republic of the congo', 'dr congo', 'drc', 'congo kinshasa', 'democratic republic of congo'],
  'Congo': ['republic of the congo', 'congo brazzaville', 'congo republic'],
  'Ivory Coast': ['cote d ivoire', 'cote divoire', 'cote d\'ivoire'],
  'Myanmar': ['burma'],
  'North Korea': ['dprk', 'democratic peoples republic of korea'],
  'South Korea': ['republic of korea', 'rok'],
  'Russia': ['russian federation'],
  'Turkey': ['turkiye'],
  'United Arab Emirates': ['uae', 'emirates'],
  'United Kingdom': ['uk', 'britain', 'great britain', 'england', 'scotland', 'wales'],
  'United States': ['us', 'usa', 'united states of america', 'america'],
  'Vietnam': ['viet nam'],
  'Trinidad and Tobago': ['trinidad', 'tobago'],
  'Eswatini': ['swaziland'],
  'North Macedonia': ['macedonia', 'fyrom'],
  'Timor-Leste': ['east timor'],
  'Cabo Verde': ['cape verde'],
  'Central African Republic': ['car', 'centrafrique'],
  'Bosnia': ['bosnia and herzegovina', 'bosnia herzegovina'],
  'Papua New Guinea': ['png'],
  'Sao Tome and Principe': ['sao tome', 'sao tome and principe'],
  'Saint Kitts and Nevis': ['st kitts', 'st kitts and nevis'],
  'Saint Lucia': ['st lucia'],
  'Saint Vincent and the Grenadines': ['st vincent', 'st vincent and the grenadines'],
  'Antigua and Barbuda': ['antigua'],
  'Dominican Republic': ['dominican rep'],
  'Equatorial Guinea': ['eq guinea'],
  'Guinea-Bissau': ['guinea bissau'],
  'South Sudan': ['s sudan'],
  'Saudi Arabia': ['ksa', 'kingdom of saudi arabia'],
  'New Zealand': ['aotearoa'],
  'Micronesia': ['federated states of micronesia', 'fsm'],
  'Marshall Islands': ['rmi'],
  'Solomon Islands': ['solomon is']
};

const LOCATION_ALIASES = {
  Kyiv: ['kiev'],
  'Ho Chi Minh': ['ho chi minh city', 'saigon'],
  'Port-au-Prince': ['port au prince'],
  'Saint Petersburg': ['st petersburg', 'st. petersburg'],
  Bangkok: ['krung thep'],
  Beijing: ['peking'],
  'Kolkata': ['calcutta'],
  'Chennai': ['madras'],
  'Mumbai': ['bombay'],
  'Yangon': ['rangoon'],
  'Astana': ['nur sultan', 'nur-sultan'],
  'Lome': ['lomé'],
  'Nouakchott': ['nouackchott'],
  'Sao Tome': ['são tomé'],
  'Da Nang': ['danang'],
  'Phnom Penh': ['phnompenh'],
};

function normalizeGeoText(value) {
  return (value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createSortedSearchEntries(entries) {
  return entries
    .filter((entry) => entry.key)
    .sort((a, b) => b.key.length - a.key.length);
}

const LOCATION_SEARCH_ENTRIES = createSortedSearchEntries(
  LOCATIONS.flatMap((location) => {
    const aliases = LOCATION_ALIASES[location.name] || [];
    return [location.name, ...aliases].map((alias) => ({
      key: normalizeGeoText(alias),
      location
    }));
  })
);

const COUNTRY_SEARCH_ENTRIES = createSortedSearchEntries([
  ...Object.keys(COUNTRY_CENTROIDS).map((country) => ({
    key: normalizeGeoText(country),
    country
  })),
  ...Object.entries(COUNTRY_ALIASES).flatMap(([country, aliases]) => (
    aliases.map((alias) => ({
      key: normalizeGeoText(alias),
      country
    }))
  ))
]);

const COUNTRY_LOOKUP = new Map(
  COUNTRY_SEARCH_ENTRIES.map((entry) => [entry.key, entry.country])
);

export function getCountryGeoHints(countryName, {
  maxAliases = 4,
  maxLocalities = 4
} = {}) {
  const normalizedCountry = normalizeGeoText(countryName);
  const canonicalCountry = COUNTRY_LOOKUP.get(normalizedCountry) || countryName;
  const aliases = [...new Set((COUNTRY_ALIASES[canonicalCountry] || []).filter(Boolean))].slice(0, maxAliases);
  const localities = [...new Set(
    LOCATIONS
      .filter((location) => location.country === canonicalCountry)
      .map((location) => location.name)
      .filter(Boolean)
  )].slice(0, maxLocalities);

  return {
    country: canonicalCountry || null,
    aliases,
    localities
  };
}

// Demonyms / adjective forms → country name
// Allows matching "Indonesian economy" → Indonesia, "Iranian missile" → Iran, etc.
const DEMONYMS = {
  'afghan': 'Afghanistan', 'albanian': 'Albania', 'algerian': 'Algeria',
  'angolan': 'Angola', 'argentine': 'Argentina', 'argentinian': 'Argentina',
  'armenian': 'Armenia', 'australian': 'Australia', 'austrian': 'Austria',
  'azerbaijani': 'Azerbaijan', 'bahraini': 'Bahrain', 'bangladeshi': 'Bangladesh',
  'belarusian': 'Belarus', 'belgian': 'Belgium', 'bolivian': 'Bolivia',
  'bosnian': 'Bosnia', 'brazilian': 'Brazil', 'british': 'United Kingdom',
  'bulgarian': 'Bulgaria', 'burkinabe': 'Burkina Faso', 'burmese': 'Myanmar',
  'cambodian': 'Cambodia', 'cameroonian': 'Cameroon', 'canadian': 'Canada',
  'chadian': 'Chad', 'chilean': 'Chile', 'chinese': 'China',
  'colombian': 'Colombia', 'congolese': 'Dem. Rep. Congo', 'costa rican': 'Costa Rica',
  'croatian': 'Croatia', 'cuban': 'Cuba', 'cypriot': 'Cyprus',
  'czech': 'Czech Republic', 'danish': 'Denmark', 'dominican': 'Dominican Republic',
  'dutch': 'Netherlands', 'ecuadorian': 'Ecuador', 'egyptian': 'Egypt',
  'salvadoran': 'El Salvador', 'estonian': 'Estonia', 'ethiopian': 'Ethiopia',
  'finnish': 'Finland', 'french': 'France', 'gabonese': 'Gabon',
  'georgian': 'Georgia', 'german': 'Germany', 'ghanaian': 'Ghana',
  'greek': 'Greece', 'guatemalan': 'Guatemala', 'guinean': 'Guinea',
  'haitian': 'Haiti', 'honduran': 'Honduras', 'hungarian': 'Hungary',
  'icelandic': 'Iceland', 'indian': 'India', 'indonesian': 'Indonesia',
  'iranian': 'Iran', 'iraqi': 'Iraq', 'irish': 'Ireland',
  'israeli': 'Israel', 'italian': 'Italy', 'ivorian': 'Ivory Coast',
  'jamaican': 'Jamaica', 'japanese': 'Japan', 'jordanian': 'Jordan',
  'kazakh': 'Kazakhstan', 'kenyan': 'Kenya', 'kuwaiti': 'Kuwait',
  'laotian': 'Laos', 'latvian': 'Latvia', 'lebanese': 'Lebanon',
  'libyan': 'Libya', 'lithuanian': 'Lithuania', 'malagasy': 'Madagascar',
  'malawian': 'Malawi', 'malaysian': 'Malaysia', 'malian': 'Mali',
  'mexican': 'Mexico', 'moldovan': 'Moldova', 'mongolian': 'Mongolia',
  'montenegrin': 'Montenegro', 'moroccan': 'Morocco', 'mozambican': 'Mozambique',
  'namibian': 'Namibia', 'nepalese': 'Nepal', 'nepali': 'Nepal',
  'nicaraguan': 'Nicaragua', 'nigerian': 'Nigeria', 'nigerien': 'Niger',
  'north korean': 'North Korea', 'norwegian': 'Norway', 'omani': 'Oman',
  'pakistani': 'Pakistan', 'palestinian': 'Palestine', 'panamanian': 'Panama',
  'paraguayan': 'Paraguay', 'peruvian': 'Peru', 'filipino': 'Philippines',
  'philippine': 'Philippines', 'polish': 'Poland', 'portuguese': 'Portugal',
  'qatari': 'Qatar', 'romanian': 'Romania', 'russian': 'Russia',
  'rwandan': 'Rwanda', 'saudi': 'Saudi Arabia', 'senegalese': 'Senegal',
  'serbian': 'Serbia', 'singaporean': 'Singapore', 'slovak': 'Slovakia',
  'slovenian': 'Slovenia', 'somali': 'Somalia', 'south african': 'South Africa',
  'south korean': 'South Korea', 'south sudanese': 'South Sudan',
  'spanish': 'Spain', 'sri lankan': 'Sri Lanka', 'sudanese': 'Sudan',
  'swedish': 'Sweden', 'swiss': 'Switzerland', 'syrian': 'Syria',
  'taiwanese': 'Taiwan', 'tanzanian': 'Tanzania', 'thai': 'Thailand',
  'tunisian': 'Tunisia', 'turkish': 'Turkey', 'ugandan': 'Uganda',
  'ukrainian': 'Ukraine', 'emirati': 'United Arab Emirates',
  'american': 'United States', 'uruguayan': 'Uruguay', 'uzbek': 'Uzbekistan',
  'venezuelan': 'Venezuela', 'vietnamese': 'Vietnam', 'yemeni': 'Yemen',
  'zambian': 'Zambia', 'zimbabwean': 'Zimbabwe',
  'fijian': 'Fiji', 'trinidadian': 'Trinidad and Tobago',
  'tobagonian': 'Trinidad and Tobago',
  'eritrean': 'Eritrea', 'djiboutian': 'Djibouti', 'comorian': 'Comoros',
  'mauritian': 'Mauritius', 'seychellois': 'Seychelles', 'cape verdean': 'Cabo Verde',
  'gambian': 'Gambia', 'bissau guinean': 'Guinea-Bissau', 'togolese': 'Togo',
  'liberian': 'Liberia', 'equatoguinean': 'Equatorial Guinea',
  'bruneian': 'Brunei', 'timorese': 'Timor-Leste', 'bhutanese': 'Bhutan',
  'maldivian': 'Maldives', 'turkmen': 'Turkmenistan', 'tajik': 'Tajikistan',
  'kyrgyz': 'Kyrgyzstan', 'macedonian': 'North Macedonia',
  'kosovar': 'Kosovo', 'maltese': 'Malta', 'andorran': 'Andorra',
  'bahamian': 'Bahamas', 'barbadian': 'Barbados', 'grenadian': 'Grenada',
  'saint lucian': 'Saint Lucia', 'kittitian': 'Saint Kitts and Nevis',
  'vincentian': 'Saint Vincent and the Grenadines', 'antiguan': 'Antigua and Barbuda',
  'guyanese': 'Guyana', 'surinamese': 'Suriname', 'belizean': 'Belize',
  'samoan': 'Samoa', 'tongan': 'Tonga',
  'ni vanuatu': 'Vanuatu', 'i kiribati': 'Kiribati', 'micronesian': 'Micronesia',
  'marshallese': 'Marshall Islands', 'palauan': 'Palau',
  'nauruan': 'Nauru', 'tuvaluan': 'Tuvalu',
  'swazi': 'Eswatini', 'basotho': 'Lesotho', 'motswana': 'Botswana',
  'burundian': 'Burundi', 'congolese republic': 'Congo',
  'central african': 'Central African Republic',
  'azerbaijani': 'Azerbaijan',
};

const SORTED_DEMONYMS = createSortedSearchEntries(
  Object.entries(DEMONYMS).map(([demonym, country]) => ({
    key: normalizeGeoText(demonym),
    country
  }))
);

/**
 * Check if a name match is a whole-word boundary match.
 * Prevents "Niger" from matching inside "Nigeria".
 */
function isWordBoundary(text, idx, matchLen) {
  const before = idx > 0 ? text[idx - 1] : ' ';
  const after = idx + matchLen < text.length ? text[idx + matchLen] : ' ';
  const wordChar = /[a-z0-9]/i;
  return !wordChar.test(before) && !wordChar.test(after);
}

/**
 * Try to find a country in text via country names + demonyms.
 * Returns country name or null.
 */
function findCountryInText(text) {
  for (const entry of COUNTRY_SEARCH_ENTRIES) {
    const idx = text.indexOf(entry.key);
    if (idx !== -1 && isWordBoundary(text, idx, entry.key.length)) {
      return entry.country;
    }
  }

  for (const entry of SORTED_DEMONYMS) {
    const idx = text.indexOf(entry.key);
    if (idx !== -1 && isWordBoundary(text, idx, entry.key.length)) {
      return entry.country;
    }
  }

  return null;
}

/**
 * Try to find a city/region in text.
 * Returns the best (longest) LOCATIONS match or null.
 */
function findCityInText(text) {
  let bestMatch = null;
  let bestLen = 0;

  for (const entry of LOCATION_SEARCH_ENTRIES) {
    const idx = text.indexOf(entry.key);
    if (idx !== -1 && isWordBoundary(text, idx, entry.key.length)) {
      if (entry.key.length > bestLen) {
        bestMatch = entry.location;
        bestLen = entry.key.length;
      }
    }
  }

  return bestMatch;
}

function buildLocalityResult(location, matchedOn) {
  return {
    lat: location.lat,
    lng: location.lng,
    locality: location.name,
    region: location.country,
    precision: 'locality',
    matchedOn
  };
}

function buildCountryResult(country, matchedOn) {
  const centroid = COUNTRY_CENTROIDS[country];
  if (!centroid) {
    return null;
  }

  return {
    lat: centroid[0],
    lng: centroid[1],
    locality: country,
    region: country,
    precision: 'country',
    matchedOn
  };
}

function resolveCountryName(value) {
  const normalized = normalizeGeoText(value);
  return COUNTRY_LOOKUP.get(normalized) || SOURCE_COUNTRY_MAP[value] || value;
}

/**
 * Attempt to geocode an article from its title, summary, and source country.
 * Scans title first (highest signal), then summary, then falls back to source country.
 * Returns { lat, lng, locality, region } or null.
 */
export function geocodeArticle(title, sourcecountry, summary) {
  const titleLower = normalizeGeoText(title);
  const summaryLower = normalizeGeoText(summary).slice(0, 300);

  const titleCity = findCityInText(titleLower);
  const titleCountry = findCountryInText(titleLower);
  const summaryCity = findCityInText(summaryLower);
  const summaryCountry = findCountryInText(summaryLower);

  if (titleCity && (!titleCountry || titleCountry === titleCity.country)) {
    if (!titleCountry) {
      if (summaryCity && summaryCity.country !== titleCity.country) {
        return buildLocalityResult(summaryCity, 'summary-country-conflict');
      }

      if (summaryCountry && summaryCountry !== titleCity.country) {
        const summaryCountryConflictResult = buildCountryResult(summaryCountry, 'summary-country-conflict');
        if (summaryCountryConflictResult) {
          return summaryCountryConflictResult;
        }
      }
    }

    return buildLocalityResult(titleCity, 'title-city');
  }

  if (titleCountry) {
    if (summaryCity && summaryCity.country === titleCountry) {
      return buildLocalityResult(summaryCity, 'summary-city-confirmed');
    }

    const titleCountryResult = buildCountryResult(
      titleCountry,
      titleCity && titleCity.country !== titleCountry ? 'title-country-conflict' : 'title-country'
    );
    if (titleCountryResult) {
      return titleCountryResult;
    }
  }

  if (titleCity) {
    return buildLocalityResult(titleCity, 'title-city');
  }

  if (summaryCity && (!summaryCountry || summaryCountry === summaryCity.country)) {
    return buildLocalityResult(summaryCity, 'summary-city');
  }

  if (summaryCountry) {
    const summaryCountryResult = buildCountryResult(
      summaryCountry,
      summaryCity && summaryCity.country !== summaryCountry ? 'summary-country-conflict' : 'summary-country'
    );
    if (summaryCountryResult) {
      return summaryCountryResult;
    }
  }

  if (summaryCity) {
    return buildLocalityResult(summaryCity, 'summary-city');
  }

  const countryName = resolveCountryName(sourcecountry);
  const coords = COUNTRY_CENTROIDS[countryName];
  if (coords) {
    return {
      lat: coords[0],
      lng: coords[1],
      locality: countryName,
      region: countryName,
      precision: 'source-country',
      matchedOn: 'source-country'
    };
  }

  return null;
}

/**
 * Find ALL countries mentioned in text (not just the first).
 */
function findAllCountriesInText(text) {
  const found = [];
  const seen = new Set();
  for (const entry of COUNTRY_SEARCH_ENTRIES) {
    const idx = text.indexOf(entry.key);
    if (idx !== -1 && isWordBoundary(text, idx, entry.key.length) && !seen.has(entry.country)) {
      seen.add(entry.country);
      found.push(entry.country);
    }
  }
  for (const entry of SORTED_DEMONYMS) {
    const idx = text.indexOf(entry.key);
    if (idx !== -1 && isWordBoundary(text, idx, entry.key.length) && !seen.has(entry.country)) {
      seen.add(entry.country);
      found.push(entry.country);
    }
  }
  return found;
}

/**
 * Find ALL cities mentioned in text, one per country (not just the best match).
 */
function findAllCitiesInText(text) {
  const found = [];
  const seen = new Set();
  for (const entry of LOCATION_SEARCH_ENTRIES) {
    const idx = text.indexOf(entry.key);
    if (idx !== -1 && isWordBoundary(text, idx, entry.key.length) && !seen.has(entry.location.country)) {
      seen.add(entry.location.country);
      found.push(entry.location);
    }
  }
  return found;
}

/**
 * Geocode an article to ALL mentioned countries/cities.
 * Returns an array of geo results (one per country).
 * Excludes the source country so articles appear where they're ABOUT, not where they're FROM.
 */
export function geocodeArticleAll(title, sourcecountry, summary) {
  const titleLower = normalizeGeoText(title);
  const summaryLower = normalizeGeoText(summary).slice(0, 300);
  const combinedText = `${titleLower} ${summaryLower}`;

  const cities = findAllCitiesInText(combinedText);
  const countries = findAllCountriesInText(combinedText);

  const results = [];
  const seenCountries = new Set();

  // Prefer city-level precision where available
  for (const city of cities) {
    if (!seenCountries.has(city.country)) {
      seenCountries.add(city.country);
      results.push(buildLocalityResult(city, 'title-city'));
    }
  }

  for (const country of countries) {
    if (!seenCountries.has(country)) {
      seenCountries.add(country);
      const r = buildCountryResult(country, 'title-country');
      if (r) results.push(r);
    }
  }

  // Exclude source country — article should appear where it's ABOUT, not where it's FROM
  const sourceResolved = resolveCountryName(sourcecountry);
  const filtered = results.filter((r) => r.region !== sourceResolved);

  // If filtering removed everything, keep original results (article IS about its source country)
  if (filtered.length > 0) return filtered;
  if (results.length > 0) return results;

  // Final fallback to single geocodeArticle
  const single = geocodeArticle(title, sourcecountry, summary);
  return single ? [single] : [];
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
  'Bahrain': 'BH', 'Bahamas': 'BS', 'Barbados': 'BB', 'Belize': 'BZ',
  'Benin': 'BJ', 'Bhutan': 'BT', 'Botswana': 'BW', 'Brunei': 'BN',
  'Burkina Faso': 'BF', 'Burundi': 'BI',
  'Central African Republic': 'CF', 'Congo': 'CG',
  'Dominican Republic': 'DO', 'Fiji': 'FJ', 'Guyana': 'GY',
  'Ivory Coast': 'CI', 'Kosovo': 'XK', 'Kyrgyzstan': 'KG',
  'Madagascar': 'MG', 'Malawi': 'MW', 'Maldives': 'MV',
  'Mauritania': 'MR', 'Namibia': 'NA', 'North Macedonia': 'MK',
  'Papua New Guinea': 'PG', 'Samoa': 'WS',
  'Sierra Leone': 'SL', 'Solomon Islands': 'SB', 'Suriname': 'SR',
  'Tajikistan': 'TJ', 'Timor-Leste': 'TL', 'Tonga': 'TO',
  'Trinidad and Tobago': 'TT', 'Turkmenistan': 'TM',
  'Ukraine': 'UA', 'United Arab Emirates': 'AE', 'United Kingdom': 'GB',
  'United States': 'US', 'Uruguay': 'UY', 'Uzbekistan': 'UZ',
  'Vanuatu': 'VU', 'Venezuela': 'VE',
  'Vietnam': 'VN', 'Yemen': 'YE', 'Zambia': 'ZM', 'Zimbabwe': 'ZW',
  'Eritrea': 'ER', 'Djibouti': 'DJ', 'Comoros': 'KM',
  'Mauritius': 'MU', 'Seychelles': 'SC', 'Cabo Verde': 'CV',
  'Gambia': 'GM', 'Guinea-Bissau': 'GW', 'Togo': 'TG',
  'Liberia': 'LR', 'Equatorial Guinea': 'GQ',
  'Sao Tome and Principe': 'ST', 'Eswatini': 'SZ', 'Lesotho': 'LS',
  'Brunei': 'BN', 'Timor-Leste': 'TL', 'Bhutan': 'BT', 'Maldives': 'MV',
  'Turkmenistan': 'TM', 'Tajikistan': 'TJ', 'Kyrgyzstan': 'KG',
  'North Macedonia': 'MK', 'Malta': 'MT', 'Andorra': 'AD',
  'Bahamas': 'BS', 'Barbados': 'BB', 'Grenada': 'GD',
  'Saint Lucia': 'LC', 'Saint Kitts and Nevis': 'KN',
  'Dominica': 'DM', 'Saint Vincent and the Grenadines': 'VC',
  'Antigua and Barbuda': 'AG', 'Guyana': 'GY', 'Suriname': 'SR',
  'Belize': 'BZ', 'Bolivia': 'BO',
  'Samoa': 'WS', 'Tonga': 'TO', 'Solomon Islands': 'SB',
  'Vanuatu': 'VU', 'Kiribati': 'KI', 'Micronesia': 'FM',
  'Marshall Islands': 'MH', 'Palau': 'PW', 'Tuvalu': 'TV', 'Nauru': 'NR',
  'New Caledonia': 'NC', 'French Polynesia': 'PF',
  'Armenia': 'AM', 'Azerbaijan': 'AZ', 'Croatia': 'HR',
  'Bulgaria': 'BG', 'Kosovo': 'XK'
};

const ISO_TO_COUNTRY = Object.entries(COUNTRY_TO_ISO).reduce((accumulator, [countryName, iso]) => {
  if (!accumulator[iso]) {
    accumulator[iso] = countryName;
  }
  return accumulator;
}, {});

export function countryToIso(countryName) {
  if (!countryName) return null;
  // Direct lookup first
  const direct = COUNTRY_TO_ISO[countryName];
  if (direct) return direct;
  // Resolve through aliases (e.g. "Congo-Brazzaville" → "Congo" → "CG")
  const canonical = COUNTRY_LOOKUP.get(normalizeGeoText(countryName));
  return canonical ? (COUNTRY_TO_ISO[canonical] || null) : null;
}

export function isoToCountry(iso) {
  return ISO_TO_COUNTRY[(iso || '').toUpperCase()] || null;
}

export const COUNTRY_ADJACENCY = {
  // Central/Eastern Europe
  UA: ['RU', 'BY', 'PL', 'SK', 'HU', 'RO', 'MD'],
  RU: ['UA', 'BY', 'GE', 'AZ', 'KZ', 'CN', 'MN', 'FI', 'EE', 'LV', 'LT', 'PL', 'NO'],
  BY: ['RU', 'UA', 'PL', 'LT', 'LV'],
  PL: ['DE', 'CZ', 'SK', 'UA', 'BY', 'LT', 'RU'],

  // Middle East
  SY: ['TR', 'IQ', 'JO', 'IL', 'LB'],
  IQ: ['SY', 'TR', 'IR', 'KW', 'SA', 'JO'],
  IR: ['IQ', 'TR', 'AF', 'PK', 'TM', 'AZ', 'AM'],
  IL: ['PS', 'LB', 'SY', 'JO', 'EG'],
  PS: ['IL', 'EG', 'JO'],
  LB: ['SY', 'IL'],
  YE: ['SA', 'OM'],
  SA: ['YE', 'OM', 'AE', 'QA', 'BH', 'KW', 'IQ', 'JO'],
  TR: ['SY', 'IQ', 'IR', 'GE', 'AM', 'AZ', 'BG', 'GR'],

  // East Africa
  SD: ['SS', 'TD', 'CF', 'ET', 'ER', 'EG', 'LY'],
  SS: ['SD', 'ET', 'KE', 'UG', 'CD', 'CF'],
  ET: ['ER', 'DJ', 'SO', 'KE', 'SS', 'SD'],
  SO: ['ET', 'DJ', 'KE'],
  KE: ['ET', 'SO', 'SS', 'UG', 'TZ'],
  ER: ['SD', 'ET', 'DJ'],

  // West Africa / Sahel
  ML: ['SN', 'MR', 'DZ', 'NE', 'BF', 'CI', 'GN'],
  NE: ['ML', 'BF', 'NG', 'TD', 'LY', 'DZ', 'BJ'],
  BF: ['ML', 'NE', 'BJ', 'TG', 'GH', 'CI'],
  NG: ['NE', 'TD', 'CM', 'BJ'],
  TD: ['LY', 'SD', 'CF', 'CM', 'NG', 'NE'],

  // Central Africa
  CD: ['CG', 'CF', 'SS', 'UG', 'RW', 'BI', 'TZ', 'ZM', 'AO'],
  CF: ['CM', 'TD', 'SD', 'SS', 'CD', 'CG'],

  // North Africa
  LY: ['TN', 'DZ', 'NE', 'TD', 'SD', 'EG'],
  EG: ['LY', 'SD', 'IL', 'PS'],

  // South/Central Asia
  AF: ['PK', 'IR', 'TM', 'UZ', 'TJ', 'CN'],
  PK: ['AF', 'IR', 'IN', 'CN'],
  IN: ['PK', 'CN', 'NP', 'BD', 'MM', 'BT'],
  CN: ['RU', 'MN', 'KZ', 'KG', 'TJ', 'AF', 'PK', 'IN', 'NP', 'BT', 'MM', 'LA', 'VN', 'KP'],

  // Southeast Asia
  MM: ['CN', 'IN', 'BD', 'LA', 'TH'],
  TH: ['MM', 'LA', 'KH', 'MY'],

  // East Asia
  KP: ['CN', 'KR', 'RU'],
  KR: ['KP'],
  TW: ['CN'],  // political adjacency

  // Southern Africa
  MZ: ['TZ', 'MW', 'ZM', 'ZW', 'ZA', 'SZ'],
  ZW: ['ZA', 'BW', 'ZM', 'MZ'],
  BW: ['ZA', 'NA', 'ZW', 'ZM'],
  NA: ['AO', 'BW', 'ZA', 'ZM'],
  ZM: ['CD', 'TZ', 'MW', 'MZ', 'ZW', 'BW', 'NA', 'AO'],
  AO: ['CD', 'CG', 'ZM', 'NA'],

  // West Africa
  GH: ['CI', 'TG', 'BF'],
  CI: ['ML', 'BF', 'GH', 'LR', 'GN'],
  SN: ['MR', 'ML', 'GN', 'GW', 'GM'],
  GN: ['SN', 'ML', 'CI', 'LR', 'SL', 'GW'],
  SL: ['GN', 'LR'],
  LR: ['SL', 'GN', 'CI'],
  TG: ['GH', 'BF', 'BJ'],
  BJ: ['TG', 'BF', 'NE', 'NG'],

  // East Africa
  TZ: ['KE', 'UG', 'RW', 'BI', 'CD', 'ZM', 'MW', 'MZ'],
  UG: ['KE', 'SS', 'CD', 'RW', 'TZ'],
  RW: ['UG', 'CD', 'BI', 'TZ'],
  BI: ['RW', 'CD', 'TZ'],

  // Central Asia
  KZ: ['RU', 'CN', 'KG', 'UZ', 'TM'],
  UZ: ['KZ', 'KG', 'TJ', 'AF', 'TM'],
  TM: ['KZ', 'UZ', 'AF', 'IR'],
  TJ: ['KG', 'UZ', 'AF', 'CN'],
  KG: ['KZ', 'UZ', 'TJ', 'CN'],

  // Caucasus
  GE: ['RU', 'TR', 'AM', 'AZ'],
  AM: ['GE', 'TR', 'IR', 'AZ'],
  AZ: ['RU', 'GE', 'AM', 'IR', 'TR'],

  // Southeast Asia
  KH: ['TH', 'LA', 'VN'],
  LA: ['CN', 'MM', 'TH', 'KH', 'VN'],
  VN: ['CN', 'LA', 'KH'],
  MY: ['TH', 'ID', 'BN', 'SG'],
  ID: ['MY', 'PG', 'TL'],

  // Americas
  MX: ['US', 'GT', 'BZ'],
  CO: ['VE', 'BR', 'PE', 'EC', 'PA'],
  VE: ['CO', 'BR', 'GY'],
  GY: ['VE', 'BR', 'SR'],
  SR: ['GY', 'BR', 'FR'],
  BZ: ['MX', 'GT'],
  GT: ['MX', 'BZ', 'SV', 'HN'],
  HN: ['GT', 'SV', 'NI'],
  SV: ['GT', 'HN'],
  NI: ['HN', 'CR'],
  CR: ['NI', 'PA'],
  PA: ['CR', 'CO'],
  EC: ['CO', 'PE'],
  PE: ['EC', 'CO', 'BR', 'BO', 'CL'],
  BO: ['PE', 'BR', 'PY', 'AR', 'CL'],
  PY: ['BO', 'BR', 'AR'],
  UY: ['BR', 'AR'],
  CL: ['PE', 'BO', 'AR'],
  AR: ['CL', 'BO', 'PY', 'BR', 'UY'],
  BR: ['VE', 'GY', 'SR', 'CO', 'PE', 'BO', 'PY', 'AR', 'UY'],
};

export function areCountriesAdjacent(iso1, iso2) {
  return (COUNTRY_ADJACENCY[iso1] || []).includes(iso2) ||
         (COUNTRY_ADJACENCY[iso2] || []).includes(iso1);
}

export const KNOWN_COUNTRY_NAMES = Object.keys(COUNTRY_TO_ISO).sort();
