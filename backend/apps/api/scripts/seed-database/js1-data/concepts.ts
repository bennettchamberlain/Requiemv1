import { type CreateConceptDto } from '@ci/domains/memory/types';

type SeedConcept = RequiredFields<CreateConceptDto, 'id'>;

export const MACHINE_LEARNING: SeedConcept = {
  id: '019b7de0-05cd-777d-878a-516c4cf60ea6',
  name: 'Machine Learning',
  description: 'AI and data science concepts',
  properties: {
    type: 'Technology',
  },
};

export const ENTREPRENEURSHIP: SeedConcept = {
  id: '019b7de0-05ce-714d-af2f-d339ebf22852',
  name: 'Entrepreneurship',
  description: 'Starting and running businesses',
  properties: {
    type: 'Business',
  },
};

export const PHOTOGRAPHY: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0ae-e051cf000750',
  name: 'Photography',
  description: 'Art of capturing images',
  properties: {
    type: 'Hobby',
  },
};

export const COOKING: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0ae-e7a64ef62346',
  name: 'Cooking',
  description: 'Culinary arts and food preparation',
  properties: {
    type: 'Hobby',
  },
};

export const TRAVEL: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0ae-e8d40dad44da',
  name: 'Travel',
  description: 'Exploring new places and cultures',
  properties: {
    type: 'Interest',
  },
};

export const FITNESS: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0ae-efb45dd1fe6b',
  name: 'Fitness',
  description: 'Physical exercise and wellness',
  properties: {
    type: 'Health',
  },
};

export const MUSIC_PRODUCTION: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0ae-f2afae8c2885',
  name: 'Music Production',
  description: 'Creating and producing music',
  properties: {
    type: 'Creative',
  },
};

export const SUSTAINABLE_LIVING: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0ae-f4b058cb5b2c',
  name: 'Sustainable Living',
  description: 'Environmentally conscious living',
  properties: {
    type: 'Lifestyle',
  },
};

export const PIZZA: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0ae-f83a08240d17',
  name: 'Pizza',
  description: 'Flatbread with tomato sauce, cheese, and various toppings',
  properties: {
    type: 'Food',
    cuisine: 'Italian',
    common_variations: ['Margherita', 'Pepperoni', 'Hawaiian', 'BBQ Chicken'],
  },
};

export const SUSHI: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0ae-fdbfd4781572',
  name: 'Sushi',
  description: 'Vinegared rice with raw fish and vegetables',
  properties: {
    type: 'Food',
    cuisine: 'Japanese',
    common_variations: ['Nigiri', 'Maki', 'Sashimi', 'Temaki'],
  },
};

export const TACOS: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-0180acb46529',
  name: 'Tacos',
  description: 'Corn or wheat tortilla folded around various fillings',
  properties: {
    type: 'Food',
    cuisine: 'Mexican',
    common_variations: ['Carne Asada', 'Al Pastor', 'Fish', 'Vegetarian'],
  },
};

export const THAI_FOOD: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-07c3a07c1a84',
  name: 'Thai Food',
  description: 'Cuisine known for balance of sweet, sour, salty, and spicy',
  properties: {
    type: 'Cuisine',
    region: 'Southeast Asia',
    signature_dishes: ['Pad Thai', 'Green Curry', 'Tom Yum', 'Massaman Curry'],
  },
};

export const ITALIAN_CUISINE: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-0858f1768134',
  name: 'Italian Cuisine',
  description: 'Mediterranean cuisine emphasizing fresh ingredients and regional diversity',
  properties: {
    type: 'Cuisine',
    region: 'Southern Europe',
    signature_dishes: ['Pasta', 'Risotto', 'Osso Buco', 'Tiramisu'],
  },
};

export const BBQ: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-0c35f80f252b',
  name: 'BBQ',
  description: 'Slow-cooked meat with smoke and spice-based rubs or sauces',
  properties: {
    type: 'Food',
    cuisine: 'American',
    regional_styles: ['Texas', 'Kansas City', 'Carolina', 'Memphis'],
  },
};

export const VEGETARIAN: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-1015f6a24261',
  name: 'Vegetarian',
  description: 'Plant-based diet excluding meat and fish',
  properties: {
    type: 'Dietary preference',
    common_foods: ['Vegetables', 'Legumes', 'Grains', 'Tofu'],
  },
};

export const INDIAN_CUISINE: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-1450c34be8cc',
  name: 'Indian Cuisine',
  description: 'Diverse cuisine with complex spice combinations and regional variations',
  properties: {
    type: 'Cuisine',
    region: 'South Asia',
    signature_dishes: ['Curry', 'Biryani', 'Tandoori', 'Dosa'],
  },
};

export const MEXICAN_FOOD: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-18ffb16f7cbf',
  name: 'Mexican Food',
  description: 'Vibrant cuisine featuring corn, beans, chilies, and indigenous ingredients',
  properties: {
    type: 'Cuisine',
    region: 'North America',
    signature_dishes: ['Tacos', 'Enchiladas', 'Mole', 'Tamales'],
  },
};

export const CHINESE_FOOD: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-1d69d862985a',
  name: 'Chinese Food',
  description: 'Ancient cuisine with regional styles and wok-based cooking techniques',
  properties: {
    type: 'Cuisine',
    region: 'East Asia',
    regional_styles: ['Cantonese', 'Sichuan', 'Hunan', 'Shanghainese'],
  },
};

export const MEDITERRANEAN: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-21cf0d84ad4a',
  name: 'Mediterranean',
  description: 'Healthy cuisine emphasizing olive oil, vegetables, fish, and whole grains',
  properties: {
    type: 'Cuisine',
    region: 'Mediterranean',
    signature_dishes: ['Hummus', 'Falafel', 'Grilled Fish', 'Greek Salad'],
  },
};

export const SEAFOOD: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-264b599d6120',
  name: 'Seafood',
  description: 'Fish, shellfish, and other marine life prepared as food',
  properties: {
    type: 'Food',
    common_types: ['Fish', 'Shrimp', 'Crab', 'Lobster', 'Oysters'],
  },
};

export const SCIFI: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-289a0c002ce7',
  name: 'Sci-Fi',
  description: 'Science fiction exploring futuristic concepts and technology',
  properties: {
    type: 'Movie genre',
    themes: ['Space exploration', 'AI', 'Time travel', 'Dystopia'],
    example_films: ['Blade Runner', 'Interstellar', 'The Matrix'],
  },
};

export const ACTION: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-2cf8a7faeace',
  name: 'Action',
  description: 'High-energy films with physical stunts and excitement',
  properties: {
    type: 'Movie genre',
    themes: ['Heroes', 'Combat', 'Chase sequences', 'Explosions'],
    example_films: ['Die Hard', 'Mad Max', 'John Wick'],
  },
};

export const COMEDY: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-31ca1fc8c78c',
  name: 'Comedy',
  description: 'Films designed to provoke laughter and amusement',
  properties: {
    type: 'Movie genre',
    sub_genres: ['Romantic comedy', 'Dark comedy', 'Slapstick', 'Satire'],
    example_films: ['Airplane!', 'The Grand Budapest Hotel', 'Superbad'],
  },
};

export const DRAMA: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-364dee28df8c',
  name: 'Drama',
  description: 'Character-driven narratives exploring emotional themes',
  properties: {
    type: 'Movie genre',
    themes: ['Relationships', 'Personal growth', 'Conflict', 'Social issues'],
    example_films: ['The Shawshank Redemption', "Schindler's List", 'Moonlight'],
  },
};

export const THRILLER: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-3ad5678fa71b',
  name: 'Thriller',
  description: 'Suspenseful films creating tension and anticipation',
  properties: {
    type: 'Movie genre',
    sub_genres: ['Psychological', 'Crime', 'Spy', 'Legal'],
    example_films: ['Se7en', 'Gone Girl', 'The Silence of the Lambs'],
  },
};

export const HORROR: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-3ec6ddaacfaa',
  name: 'Horror',
  description: 'Films intended to frighten and unsettle audiences',
  properties: {
    type: 'Movie genre',
    sub_genres: ['Slasher', 'Supernatural', 'Psychological', 'Gore'],
    example_films: ['The Exorcist', 'Get Out', 'Hereditary'],
  },
};

export const DOCUMENTARY: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-4156a7a619b5',
  name: 'Documentary',
  description: 'Non-fiction films depicting real events and people',
  properties: {
    type: 'Movie genre',
    sub_genres: ['Nature', 'Biography', 'Historical', 'Social issues'],
    example_films: ['Planet Earth', "Won't You Be My Neighbor?", 'Free Solo'],
  },
};

export const ANIMATION: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-456bb3d55cf0',
  name: 'Animation',
  description: 'Films using illustrated or computer-generated imagery',
  properties: {
    type: 'Movie genre',
    techniques: ['2D', '3D CGI', 'Stop-motion', 'Anime'],
    example_films: ['Spirited Away', 'Toy Story', 'Spider-Verse'],
  },
};

export const ROMANCE: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-495e4113a12c',
  name: 'Romance',
  description: 'Films centered on romantic love and relationships',
  properties: {
    type: 'Movie genre',
    themes: ['Love stories', 'Heartbreak', 'Marriage', 'Dating'],
    example_films: ['The Notebook', 'Before Sunrise', 'Pride and Prejudice'],
  },
};

export const MYSTERY: SeedConcept = {
  id: '019b7de0-05cf-73dc-b0af-4d3a504d3e4f',
  name: 'Mystery',
  description: 'Films involving puzzles, investigations, and revelations',
  properties: {
    type: 'Movie genre',
    themes: ['Whodunit', 'Detective work', 'Clues', 'Twists'],
    example_films: ['Knives Out', 'The Usual Suspects', 'Chinatown'],
  },
};

export const ROCK: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-84acc26b9637',
  name: 'Rock',
  description: 'Genre emphasizing electric guitars, strong rhythms, and attitude',
  properties: {
    type: 'Music genre',
    sub_genres: ['Classic Rock', 'Hard Rock', 'Alternative', 'Indie Rock'],
    origin: '1950s USA/UK',
    characteristics: ['Guitar-driven', 'Energetic', 'Rebellious'],
  },
};

export const JAZZ: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-894625b2a32c',
  name: 'Jazz',
  description: 'Sophisticated genre featuring improvisation and complex harmonies',
  properties: {
    type: 'Music genre',
    sub_genres: ['Bebop', 'Smooth Jazz', 'Fusion', 'Cool Jazz'],
    origin: 'Early 20th century New Orleans',
    characteristics: ['Improvisation', 'Swing', 'Complex chords'],
  },
};

export const CLASSICAL: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-8f702c427547',
  name: 'Classical',
  description: 'Western art music tradition spanning centuries',
  properties: {
    type: 'Music genre',
    periods: ['Baroque', 'Classical', 'Romantic', 'Modern'],
    origin: 'Medieval Europe',
    characteristics: ['Orchestral', 'Complex compositions', 'Formal structure'],
  },
};

export const HIP_HOP: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-92ac09da74b7',
  name: 'Hip Hop',
  description: 'Urban genre featuring rhythmic vocals over beats',
  properties: {
    type: 'Music genre',
    sub_genres: ['Trap', 'Boom Bap', 'Conscious Rap', 'Mumble Rap'],
    origin: '1970s Bronx, New York',
    characteristics: ['Rapping', 'Sampling', 'Beats'],
  },
};

export const ELECTRONIC: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-973b52f29e95',
  name: 'Electronic',
  description: 'Music produced primarily with electronic instruments and technology',
  properties: {
    type: 'Music genre',
    sub_genres: ['House', 'Techno', 'Dubstep', 'Ambient'],
    origin: '1970s-1980s',
    characteristics: ['Synthesizers', 'Digital production', 'Dance-oriented'],
  },
};

export const POP: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-98c506a6daa2',
  name: 'Pop',
  description: 'Mainstream music designed for broad appeal',
  properties: {
    type: 'Music genre',
    sub_genres: ['Dance Pop', 'Teen Pop', 'Synth Pop', 'Indie Pop'],
    origin: '1950s',
    characteristics: ['Catchy melodies', 'Verse-chorus structure', 'Radio-friendly'],
  },
};

export const COUNTRY: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-9fbeb14ab8fa',
  name: 'Country',
  description: 'American roots music with rural and working-class themes',
  properties: {
    type: 'Music genre',
    sub_genres: ['Outlaw Country', 'Country Pop', 'Bluegrass', 'Honky Tonk'],
    origin: '1920s Southern USA',
    characteristics: ['Storytelling', 'Acoustic instruments', 'Twang'],
  },
};

export const RB: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-a170b9357fc7',
  name: 'R&B',
  description: 'Rhythm and blues combining soul, funk, and pop elements',
  properties: {
    type: 'Music genre',
    sub_genres: ['Contemporary R&B', 'Neo-Soul', 'Funk'],
    origin: '1940s African American communities',
    characteristics: ['Soulful vocals', 'Groove', 'Emotional'],
  },
};

export const INDIE: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-a4cf91dee967',
  name: 'Indie',
  description: 'Independent music outside mainstream commercial production',
  properties: {
    type: 'Music genre',
    sub_genres: ['Indie Rock', 'Indie Folk', 'Indie Pop'],
    origin: '1970s-1980s',
    characteristics: ['DIY ethos', 'Experimental', 'Non-commercial'],
  },
};

export const METAL: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-a80dbf0ca68e',
  name: 'Metal',
  description: 'Heavy music with distorted guitars and aggressive sound',
  properties: {
    type: 'Music genre',
    sub_genres: ['Heavy Metal', 'Thrash', 'Death Metal', 'Power Metal'],
    origin: 'Late 1960s-1970s',
    characteristics: ['Heavy distortion', 'Power', 'Technical skill'],
  },
};

export const HIKING: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-aeb4dd05cb55',
  name: 'Hiking',
  description: 'Walking in natural environments on trails',
  properties: {
    type: 'activity',
    category: 'Outdoor/Fitness',
    benefits: ['Cardiovascular health', 'Mental clarity', 'Nature connection'],
    equipment: ['Hiking boots', 'Backpack', 'Water'],
  },
};

export const READING: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-b3569e77160f',
  name: 'Reading',
  description: 'Engaging with written literature and information',
  properties: {
    type: 'activity',
    category: 'Indoor/Educational',
    benefits: ['Knowledge', 'Vocabulary', 'Stress reduction'],
    formats: ['Books', 'E-readers', 'Audiobooks'],
  },
};

export const GAMING: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-b4a541b11674',
  name: 'Gaming',
  description: 'Playing video games across various platforms',
  properties: {
    type: 'activity',
    category: 'Indoor/Entertainment',
    benefits: ['Problem-solving', 'Hand-eye coordination', 'Social connection'],
    platforms: ['PC', 'Console', 'Mobile', 'VR'],
  },
};

export const SWIMMING: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-bbd045f9c1f6',
  name: 'Swimming',
  description: 'Propelling through water using limbs',
  properties: {
    type: 'activity',
    category: 'Fitness/Water Sport',
    benefits: ['Full-body workout', 'Low-impact', 'Flexibility'],
    styles: ['Freestyle', 'Backstroke', 'Breaststroke'],
  },
};

export const CYCLING: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-bded4ddc034b',
  name: 'Cycling',
  description: 'Riding bicycles for exercise or transportation',
  properties: {
    type: 'activity',
    category: 'Outdoor/Fitness',
    benefits: ['Cardiovascular health', 'Leg strength', 'Eco-friendly transport'],
    types: ['Road', 'Mountain', 'Commuting'],
  },
};

export const YOGA: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-c25997002d36',
  name: 'Yoga',
  description: 'Physical, mental, and spiritual practice combining poses and breathing',
  properties: {
    type: 'activity',
    category: 'Fitness/Wellness',
    benefits: ['Flexibility', 'Stress reduction', 'Mind-body connection'],
    styles: ['Hatha', 'Vinyasa', 'Yin', 'Hot Yoga'],
  },
};

export const RUNNING: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-c51b53fe3413',
  name: 'Running',
  description: 'Moving at speed on foot',
  properties: {
    type: 'activity',
    category: 'Outdoor/Fitness',
    benefits: ['Cardiovascular health', 'Endurance', 'Mental health'],
    types: ['Sprinting', 'Distance', 'Trail running'],
  },
};

export const PAINTING: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-ca45c843070f',
  name: 'Painting',
  description: 'Creating visual art with pigments on surfaces',
  properties: {
    type: 'activity',
    category: 'Creative/Art',
    benefits: ['Creativity', 'Self-expression', 'Relaxation'],
    mediums: ['Oil', 'Acrylic', 'Watercolor', 'Digital'],
  },
};

export const WRITING: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-cd90ceb52d84',
  name: 'Writing',
  description: 'Composing text for various purposes',
  properties: {
    type: 'activity',
    category: 'Creative/Educational',
    benefits: ['Self-expression', 'Communication skills', 'Mental clarity'],
    forms: ['Fiction', 'Poetry', 'Journalism', 'Blogging'],
  },
};

export const DANCING: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-d1f6e1787033',
  name: 'Dancing',
  description: 'Moving rhythmically to music',
  properties: {
    type: 'activity',
    category: 'Fitness/Creative',
    benefits: ['Cardiovascular health', 'Coordination', 'Social connection'],
    styles: ['Ballet', 'Hip Hop', 'Salsa', 'Contemporary'],
  },
};

export const COFFEE: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-d49dd7caa02d',
  name: 'Coffee',
  description: 'Brewed drink from roasted coffee beans',
  properties: {
    type: 'beverage',
    category: 'Hot/Caffeinated',
    caffeine_content: 'High',
    varieties: ['Espresso', 'Americano', 'Latte', 'Cappuccino'],
    origin: 'Ethiopia',
  },
};

export const TEA: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-dbcfeee24f9f',
  name: 'Tea',
  description: 'Aromatic beverage from Camellia sinensis leaves',
  properties: {
    type: 'beverage',
    category: 'Hot/Caffeinated',
    caffeine_content: 'Moderate',
    varieties: ['Green', 'Black', 'Oolong', 'White', 'Herbal'],
    origin: 'China',
  },
};

export const BEER: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-dfb785682646',
  name: 'Beer',
  description: 'Fermented alcoholic drink made from grains',
  properties: {
    type: 'beverage',
    category: 'Alcoholic',
    alcohol_content: 'Moderate (4-6%)',
    styles: ['Lager', 'IPA', 'Stout', 'Wheat', 'Pilsner'],
  },
};

export const WINE: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-e31397ad9a83',
  name: 'Wine',
  description: 'Fermented alcoholic drink made from grapes',
  properties: {
    type: 'beverage',
    category: 'Alcoholic',
    alcohol_content: 'Moderate-High (12-15%)',
    varieties: ['Red', 'White', 'Rosé', 'Sparkling'],
  },
};

export const COCKTAILS: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-e5127cd9f8aa',
  name: 'Cocktails',
  description: 'Mixed drinks combining spirits with other ingredients',
  properties: {
    type: 'beverage',
    category: 'Alcoholic/Mixed',
    alcohol_content: 'Variable',
    classic_examples: ['Martini', 'Margarita', 'Old Fashioned', 'Mojito'],
  },
};

export const SMOOTHIES: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-e92c9618e459',
  name: 'Smoothies',
  description: 'Blended drinks typically made with fruits and vegetables',
  properties: {
    type: 'beverage',
    category: 'Non-Alcoholic/Healthy',
    caffeine_content: 'None',
    common_ingredients: ['Fruits', 'Vegetables', 'Yogurt', 'Protein powder'],
  },
};

export const ESPRESSO: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-ed8917d5992f',
  name: 'Espresso',
  description: 'Concentrated coffee brewed by forcing hot water through finely-ground beans',
  properties: {
    type: 'beverage',
    category: 'Hot/Caffeinated',
    caffeine_content: 'Very High',
    styles: ['Single', 'Double', 'Ristretto', 'Lungo'],
  },
};

export const KOMBUCHA: SeedConcept = {
  id: '019b7de0-05d0-7671-9725-f3d1ea99aff7',
  name: 'Kombucha',
  description: 'Fermented tea drink with probiotics',
  properties: {
    type: 'beverage',
    category: 'Fermented/Health',
    caffeine_content: 'Low',
    alcohol_content: 'Trace (<0.5%)',
    benefits: ['Probiotics', 'Antioxidants'],
  },
};

export const CONCEPTS: SeedConcept[] = [
  MACHINE_LEARNING,
  ENTREPRENEURSHIP,
  PHOTOGRAPHY,
  COOKING,
  TRAVEL,
  FITNESS,
  MUSIC_PRODUCTION,
  SUSTAINABLE_LIVING,
  PIZZA,
  SUSHI,
  TACOS,
  THAI_FOOD,
  ITALIAN_CUISINE,
  BBQ,
  VEGETARIAN,
  INDIAN_CUISINE,
  MEXICAN_FOOD,
  CHINESE_FOOD,
  MEDITERRANEAN,
  SEAFOOD,
  SCIFI,
  ACTION,
  COMEDY,
  DRAMA,
  THRILLER,
  HORROR,
  DOCUMENTARY,
  ANIMATION,
  ROMANCE,
  MYSTERY,
  ROCK,
  JAZZ,
  CLASSICAL,
  HIP_HOP,
  ELECTRONIC,
  POP,
  COUNTRY,
  RB,
  INDIE,
  METAL,
  HIKING,
  READING,
  GAMING,
  SWIMMING,
  CYCLING,
  YOGA,
  RUNNING,
  PAINTING,
  WRITING,
  DANCING,
  COFFEE,
  TEA,
  BEER,
  WINE,
  COCKTAILS,
  SMOOTHIES,
  ESPRESSO,
  KOMBUCHA,
];
