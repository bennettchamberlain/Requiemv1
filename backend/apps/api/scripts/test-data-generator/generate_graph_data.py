#!/usr/bin/env python3
"""
Graph Test Data Generator

Generates realistic test data for the CI-Server graph system:
- Creates entities (Person, Location, Object, Concept)
- Creates relationships between entities
- Populates the entities and relationships tables

Usage:
    python generate_graph_data.py [--user-id USER_ID] [--num-people N] [--num-companies N]
"""

import argparse
import json
import os
import random
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple
import psycopg2
from psycopg2.extras import RealDictCursor
from pathlib import Path

# Sample data for realistic generation
FIRST_NAMES = [
    "Alex", "Sarah", "Michael", "Emily", "David", "Jessica", "Chris", "Ashley",
    "James", "Amanda", "Robert", "Jennifer", "John", "Lisa", "Matthew", "Karen",
    "Daniel", "Susan", "Andrew", "Maria", "Joshua", "Nancy", "Ryan", "Betty"
]

LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
    "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
    "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson"
]

COMPANIES = [
    "TechCorp", "DataSystems", "CloudWorks", "InnovateLabs", "DigitalSolutions",
    "SmartTech", "FutureSoft", "WebDynamics", "CodeCraft", "ByteForge",
    "NexGen Solutions", "Quantum Labs", "Cyber Innovations", "AI Ventures"
]

LOCATIONS = [
    # John Smith's primary locations - Home in Laguna Beach, work in LA area
    {"name": "John Smith's Residence", "type": "Home", "lat": 33.5427, "lng": -117.7854},  # Laguna Beach, CA
    {"name": "Acme Construction HQ", "type": "Work Site", "lat": 34.0300, "lng": -118.4800},
    {"name": "Highway Overpass Project Site A", "type": "Work Site", "lat": 34.0400, "lng": -118.5100},
    {"name": "Santa Monica Fitness Gym", "type": "Gym", "lat": 34.0150, "lng": -118.4950},
    {"name": "Ocean View Park", "type": "Park", "lat": 34.0100, "lng": -118.4980},
    {"name": "St. Michael's Private School", "type": "School", "lat": 34.0250, "lng": -118.4850},
    {"name": "SoundWave Studios", "type": "Music Studio", "lat": 34.0350, "lng": -118.4700},
    {"name": "The Rhythm Room", "type": "Music Studio", "lat": 34.0320, "lng": -118.4750},
    {"name": "Westside Park Soccer Field", "type": "Park", "lat": 34.0180, "lng": -118.5050},
    {"name": "Tina's Ballet Academy", "type": "School", "lat": 34.0280, "lng": -118.4880},
    # Conference and travel locations
    {"name": "GreenBuild Conference Center LA", "type": "Conference Center", "lat": 34.0522, "lng": -118.2437},
    {"name": "Palm Springs Getaway Hotel", "type": "Hotel", "lat": 33.8303, "lng": -116.5453},
    # Additional local places (clinics, gyms, work sites, music venues, parks)
    {"name": "Local Clinic 1", "type": "Clinic", "lat": 34.005222, "lng": -118.46844},
    {"name": "Local Clinic 2", "type": "Clinic", "lat": 34.02045, "lng": -118.463387},
    {"name": "Local Clinic 3", "type": "Clinic", "lat": 34.009594, "lng": -118.49982},
    {"name": "Westside Gym", "type": "Gym", "lat": 34.032695, "lng": -118.496525},
    {"name": "Fitness Center", "type": "Gym", "lat": 34.032988, "lng": -118.473816},
    {"name": "Work Site B", "type": "Work Site", "lat": 34.049869, "lng": -118.454499},
    {"name": "Work Site C", "type": "Work Site", "lat": 33.990009, "lng": -118.473709},
    {"name": "Work Site D", "type": "Work Site", "lat": 34.031064, "lng": -118.495344},
    {"name": "Community Park", "type": "Park", "lat": 34.046953, "lng": -118.460672},
    {"name": "Recreation Park", "type": "Park", "lat": 33.998429, "lng": -118.464188},
    {"name": "Music Studio A", "type": "Music Studio", "lat": 34.005949, "lng": -118.49511},
    {"name": "Music Studio B", "type": "Music Studio", "lat": 33.996748, "lng": -118.471949},
    {"name": "Music Studio C", "type": "Music Studio", "lat": 34.030576, "lng": -118.478376},
    {"name": "Conference Center A", "type": "Conference Center", "lat": 33.991395, "lng": -118.472243},
    {"name": "Conference Center B", "type": "Conference Center", "lat": 34.041697, "lng": -118.492042},
    {"name": "Conference Center C", "type": "Conference Center", "lat": 34.044401, "lng": -118.452686},
]

OBJECTS = [
    {"name": "MacBook Pro", "type": "Laptop", "properties": {"brand": "Apple", "year": 2023}},
    {"name": "iPhone 15", "type": "Phone", "properties": {"brand": "Apple", "color": "Blue"}},
    {"name": "Tesla Model 3", "type": "Car", "properties": {"brand": "Tesla", "year": 2023}},
    {"name": "Gaming Setup", "type": "Computer", "properties": {"gpu": "RTX 4080", "cpu": "Intel i9"}},
    {"name": "Espresso Machine", "type": "Appliance", "properties": {"brand": "Breville", "type": "Barista Express"}},
    {"name": "Road Bike", "type": "Vehicle", "properties": {"brand": "Trek", "type": "Mountain"}},
    {"name": "Camera", "type": "Electronics", "properties": {"brand": "Canon", "model": "EOS R5"}},
    {"name": "Headphones", "type": "Audio", "properties": {"brand": "Sony", "model": "WH-1000XM5"}}
]

CONCEPTS = [
    {"name": "Machine Learning", "type": "Technology", "description": "AI and data science concepts"},
    {"name": "Entrepreneurship", "type": "Business", "description": "Starting and running businesses"},
    {"name": "Photography", "type": "Hobby", "description": "Art of capturing images"},
    {"name": "Cooking", "type": "Hobby", "description": "Culinary arts and food preparation"},
    {"name": "Travel", "type": "Interest", "description": "Exploring new places and cultures"},
    {"name": "Fitness", "type": "Health", "description": "Physical exercise and wellness"},
    {"name": "Music Production", "type": "Creative", "description": "Creating and producing music"},
    {"name": "Sustainable Living", "type": "Lifestyle", "description": "Environmentally conscious living"}
]

FOOD_PREFERENCES = [
    {"name": "Pizza", "type": "food", "cuisine": "Italian", "description": "Flatbread with tomato sauce, cheese, and various toppings", "common_variations": ["Margherita", "Pepperoni", "Hawaiian", "BBQ Chicken"]},
    {"name": "Sushi", "type": "food", "cuisine": "Japanese", "description": "Vinegared rice with raw fish and vegetables", "common_variations": ["Nigiri", "Maki", "Sashimi", "Temaki"]},
    {"name": "Tacos", "type": "food", "cuisine": "Mexican", "description": "Corn or wheat tortilla folded around various fillings", "common_variations": ["Carne Asada", "Al Pastor", "Fish", "Vegetarian"]},
    {"name": "Thai Food", "type": "cuisine", "region": "Southeast Asia", "description": "Cuisine known for balance of sweet, sour, salty, and spicy", "signature_dishes": ["Pad Thai", "Green Curry", "Tom Yum", "Massaman Curry"]},
    {"name": "Italian Cuisine", "type": "cuisine", "region": "Southern Europe", "description": "Mediterranean cuisine emphasizing fresh ingredients and regional diversity", "signature_dishes": ["Pasta", "Risotto", "Osso Buco", "Tiramisu"]},
    {"name": "BBQ", "type": "food", "cuisine": "American", "description": "Slow-cooked meat with smoke and spice-based rubs or sauces", "regional_styles": ["Texas", "Kansas City", "Carolina", "Memphis"]},
    {"name": "Vegetarian", "type": "dietary_preference", "description": "Plant-based diet excluding meat and fish", "common_foods": ["Vegetables", "Legumes", "Grains", "Tofu"]},
    {"name": "Indian Cuisine", "type": "cuisine", "region": "South Asia", "description": "Diverse cuisine with complex spice combinations and regional variations", "signature_dishes": ["Curry", "Biryani", "Tandoori", "Dosa"]},
    {"name": "Mexican Food", "type": "cuisine", "region": "North America", "description": "Vibrant cuisine featuring corn, beans, chilies, and indigenous ingredients", "signature_dishes": ["Tacos", "Enchiladas", "Mole", "Tamales"]},
    {"name": "Chinese Food", "type": "cuisine", "region": "East Asia", "description": "Ancient cuisine with regional styles and wok-based cooking techniques", "regional_styles": ["Cantonese", "Sichuan", "Hunan", "Shanghainese"]},
    {"name": "Mediterranean", "type": "cuisine", "region": "Mediterranean", "description": "Healthy cuisine emphasizing olive oil, vegetables, fish, and whole grains", "signature_dishes": ["Hummus", "Falafel", "Grilled Fish", "Greek Salad"]},
    {"name": "Seafood", "type": "food_category", "description": "Fish, shellfish, and other marine life prepared as food", "common_types": ["Fish", "Shrimp", "Crab", "Lobster", "Oysters"]}
]

MOVIE_PREFERENCES = [
    {"name": "Sci-Fi", "type": "movie_genre", "description": "Science fiction exploring futuristic concepts and technology", "themes": ["Space exploration", "AI", "Time travel", "Dystopia"], "example_films": ["Blade Runner", "Interstellar", "The Matrix"]},
    {"name": "Action", "type": "movie_genre", "description": "High-energy films with physical stunts and excitement", "themes": ["Heroes", "Combat", "Chase sequences", "Explosions"], "example_films": ["Die Hard", "Mad Max", "John Wick"]},
    {"name": "Comedy", "type": "movie_genre", "description": "Films designed to provoke laughter and amusement", "sub_genres": ["Romantic comedy", "Dark comedy", "Slapstick", "Satire"], "example_films": ["Airplane!", "The Grand Budapest Hotel", "Superbad"]},
    {"name": "Drama", "type": "movie_genre", "description": "Character-driven narratives exploring emotional themes", "themes": ["Relationships", "Personal growth", "Conflict", "Social issues"], "example_films": ["The Shawshank Redemption", "Schindler's List", "Moonlight"]},
    {"name": "Thriller", "type": "movie_genre", "description": "Suspenseful films creating tension and anticipation", "sub_genres": ["Psychological", "Crime", "Spy", "Legal"], "example_films": ["Se7en", "Gone Girl", "The Silence of the Lambs"]},
    {"name": "Horror", "type": "movie_genre", "description": "Films intended to frighten and unsettle audiences", "sub_genres": ["Slasher", "Supernatural", "Psychological", "Gore"], "example_films": ["The Exorcist", "Get Out", "Hereditary"]},
    {"name": "Documentary", "type": "movie_genre", "description": "Non-fiction films depicting real events and people", "sub_genres": ["Nature", "Biography", "Historical", "Social issues"], "example_films": ["Planet Earth", "Won't You Be My Neighbor?", "Free Solo"]},
    {"name": "Animation", "type": "movie_genre", "description": "Films using illustrated or computer-generated imagery", "techniques": ["2D", "3D CGI", "Stop-motion", "Anime"], "example_films": ["Spirited Away", "Toy Story", "Spider-Verse"]},
    {"name": "Romance", "type": "movie_genre", "description": "Films centered on romantic love and relationships", "themes": ["Love stories", "Heartbreak", "Marriage", "Dating"], "example_films": ["The Notebook", "Before Sunrise", "Pride and Prejudice"]},
    {"name": "Mystery", "type": "movie_genre", "description": "Films involving puzzles, investigations, and revelations", "themes": ["Whodunit", "Detective work", "Clues", "Twists"], "example_films": ["Knives Out", "The Usual Suspects", "Chinatown"]}
]

MUSIC_PREFERENCES = [
    {"name": "Rock", "type": "music_genre", "description": "Genre emphasizing electric guitars, strong rhythms, and attitude", "sub_genres": ["Classic Rock", "Hard Rock", "Alternative", "Indie Rock"], "origin": "1950s USA/UK", "characteristics": ["Guitar-driven", "Energetic", "Rebellious"]},
    {"name": "Jazz", "type": "music_genre", "description": "Sophisticated genre featuring improvisation and complex harmonies", "sub_genres": ["Bebop", "Smooth Jazz", "Fusion", "Cool Jazz"], "origin": "Early 20th century New Orleans", "characteristics": ["Improvisation", "Swing", "Complex chords"]},
    {"name": "Classical", "type": "music_genre", "description": "Western art music tradition spanning centuries", "periods": ["Baroque", "Classical", "Romantic", "Modern"], "origin": "Medieval Europe", "characteristics": ["Orchestral", "Complex compositions", "Formal structure"]},
    {"name": "Hip Hop", "type": "music_genre", "description": "Urban genre featuring rhythmic vocals over beats", "sub_genres": ["Trap", "Boom Bap", "Conscious Rap", "Mumble Rap"], "origin": "1970s Bronx, New York", "characteristics": ["Rapping", "Sampling", "Beats"]},
    {"name": "Electronic", "type": "music_genre", "description": "Music produced primarily with electronic instruments and technology", "sub_genres": ["House", "Techno", "Dubstep", "Ambient"], "origin": "1970s-1980s", "characteristics": ["Synthesizers", "Digital production", "Dance-oriented"]},
    {"name": "Pop", "type": "music_genre", "description": "Mainstream music designed for broad appeal", "sub_genres": ["Dance Pop", "Teen Pop", "Synth Pop", "Indie Pop"], "origin": "1950s", "characteristics": ["Catchy melodies", "Verse-chorus structure", "Radio-friendly"]},
    {"name": "Country", "type": "music_genre", "description": "American roots music with rural and working-class themes", "sub_genres": ["Outlaw Country", "Country Pop", "Bluegrass", "Honky Tonk"], "origin": "1920s Southern USA", "characteristics": ["Storytelling", "Acoustic instruments", "Twang"]},
    {"name": "R&B", "type": "music_genre", "description": "Rhythm and blues combining soul, funk, and pop elements", "sub_genres": ["Contemporary R&B", "Neo-Soul", "Funk"], "origin": "1940s African American communities", "characteristics": ["Soulful vocals", "Groove", "Emotional"]},
    {"name": "Indie", "type": "music_genre", "description": "Independent music outside mainstream commercial production", "sub_genres": ["Indie Rock", "Indie Folk", "Indie Pop"], "origin": "1970s-1980s", "characteristics": ["DIY ethos", "Experimental", "Non-commercial"]},
    {"name": "Metal", "type": "music_genre", "description": "Heavy music with distorted guitars and aggressive sound", "sub_genres": ["Heavy Metal", "Thrash", "Death Metal", "Power Metal"], "origin": "Late 1960s-1970s", "characteristics": ["Heavy distortion", "Power", "Technical skill"]}
]

ACTIVITY_PREFERENCES = [
    {"name": "Hiking", "type": "activity", "category": "Outdoor/Fitness", "description": "Walking in natural environments on trails", "benefits": ["Cardiovascular health", "Mental clarity", "Nature connection"], "equipment": ["Hiking boots", "Backpack", "Water"]},
    {"name": "Reading", "type": "activity", "category": "Indoor/Educational", "description": "Engaging with written literature and information", "benefits": ["Knowledge", "Vocabulary", "Stress reduction"], "formats": ["Books", "E-readers", "Audiobooks"]},
    {"name": "Gaming", "type": "activity", "category": "Indoor/Entertainment", "description": "Playing video games across various platforms", "benefits": ["Problem-solving", "Hand-eye coordination", "Social connection"], "platforms": ["PC", "Console", "Mobile", "VR"]},
    {"name": "Swimming", "type": "activity", "category": "Fitness/Water Sport", "description": "Propelling through water using limbs", "benefits": ["Full-body workout", "Low-impact", "Flexibility"], "styles": ["Freestyle", "Backstroke", "Breaststroke"]},
    {"name": "Cycling", "type": "activity", "category": "Outdoor/Fitness", "description": "Riding bicycles for exercise or transportation", "benefits": ["Cardiovascular health", "Leg strength", "Eco-friendly transport"], "types": ["Road", "Mountain", "Commuting"]},
    {"name": "Yoga", "type": "activity", "category": "Fitness/Wellness", "description": "Physical, mental, and spiritual practice combining poses and breathing", "benefits": ["Flexibility", "Stress reduction", "Mind-body connection"], "styles": ["Hatha", "Vinyasa", "Yin", "Hot Yoga"]},
    {"name": "Running", "type": "activity", "category": "Outdoor/Fitness", "description": "Moving at speed on foot", "benefits": ["Cardiovascular health", "Endurance", "Mental health"], "types": ["Sprinting", "Distance", "Trail running"]},
    {"name": "Painting", "type": "activity", "category": "Creative/Art", "description": "Creating visual art with pigments on surfaces", "benefits": ["Creativity", "Self-expression", "Relaxation"], "mediums": ["Oil", "Acrylic", "Watercolor", "Digital"]},
    {"name": "Writing", "type": "activity", "category": "Creative/Educational", "description": "Composing text for various purposes", "benefits": ["Self-expression", "Communication skills", "Mental clarity"], "forms": ["Fiction", "Poetry", "Journalism", "Blogging"]},
    {"name": "Dancing", "type": "activity", "category": "Fitness/Creative", "description": "Moving rhythmically to music", "benefits": ["Cardiovascular health", "Coordination", "Social connection"], "styles": ["Ballet", "Hip Hop", "Salsa", "Contemporary"]}
]

DRINK_PREFERENCES = [
    {"name": "Coffee", "type": "beverage", "category": "Hot/Caffeinated", "description": "Brewed drink from roasted coffee beans", "caffeine_content": "High", "varieties": ["Espresso", "Americano", "Latte", "Cappuccino"], "origin": "Ethiopia"},
    {"name": "Tea", "type": "beverage", "category": "Hot/Caffeinated", "description": "Aromatic beverage from Camellia sinensis leaves", "caffeine_content": "Moderate", "varieties": ["Green", "Black", "Oolong", "White", "Herbal"], "origin": "China"},
    {"name": "Beer", "type": "beverage", "category": "Alcoholic", "description": "Fermented alcoholic drink made from grains", "alcohol_content": "Moderate (4-6%)", "styles": ["Lager", "IPA", "Stout", "Wheat", "Pilsner"]},
    {"name": "Wine", "type": "beverage", "category": "Alcoholic", "description": "Fermented alcoholic drink made from grapes", "alcohol_content": "Moderate-High (12-15%)", "varieties": ["Red", "White", "Rosé", "Sparkling"]},
    {"name": "Cocktails", "type": "beverage", "category": "Alcoholic/Mixed", "description": "Mixed drinks combining spirits with other ingredients", "alcohol_content": "Variable", "classic_examples": ["Martini", "Margarita", "Old Fashioned", "Mojito"]},
    {"name": "Smoothies", "type": "beverage", "category": "Non-Alcoholic/Healthy", "description": "Blended drinks typically made with fruits and vegetables", "caffeine_content": "None", "common_ingredients": ["Fruits", "Vegetables", "Yogurt", "Protein powder"]},
    {"name": "Espresso", "type": "beverage", "category": "Hot/Caffeinated", "description": "Concentrated coffee brewed by forcing hot water through finely-ground beans", "caffeine_content": "Very High", "styles": ["Single", "Double", "Ristretto", "Lungo"]},
    {"name": "Kombucha", "type": "beverage", "category": "Fermented/Health", "description": "Fermented tea drink with probiotics", "caffeine_content": "Low", "alcohol_content": "Trace (<0.5%)", "benefits": ["Probiotics", "Antioxidants"]}
]

RELATIONSHIP_TYPES = [
    "KNOWS", "WORKS_WITH", "LIVES_IN", "VISITED", "OWNS", "INTERESTED_IN",
    "COLLABORATED_WITH", "STUDIED_AT", "WORKED_AT", "LIVES_NEAR", "USES",
    "PARTICIPATED_IN", "CREATED", "MENTORED", "TAUGHT", "LEARNED_FROM", "PREFERS", "DISLIKES",
    "SPOUSE", "PARENT_OF", "CHILD_OF", "SIBLING_OF", "FAMILY_MEMBER"
]


class GraphDataGenerator:
    def __init__(self, database_url: str, user_id: str):
        self.database_url = database_url
        self.user_id = user_id  # Keep for reference, but won't store in entities table
        self.entities: List[Dict[str, Any]] = []
        self.relationships: List[Dict[str, Any]] = []
        self._user_entity_links: Set[Tuple[str, str]] = set()
    
    @classmethod
    def from_env_file(cls, env_file_path: str = None, user_id: str = None):
        """Create generator by reading database config from .env file"""
        if env_file_path is None:
            # Look for .env file in the CI-Server root directory
            script_dir = Path(__file__).parent
            ci_server_root = script_dir.parent.parent.parent.parent.parent  # Go up to CI-Server root
            env_file_path = ci_server_root / ".env"
        
        if not os.path.exists(env_file_path):
            raise FileNotFoundError(f"Could not find .env file at {env_file_path}")
        
        # Read .env file
        env_vars = {}
        with open(env_file_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    # Remove quotes if present
                    value = value.strip().strip('"\'')
                    env_vars[key] = value
        
        # Build database URL from env vars
        host = env_vars.get('POSTGRES_HOST', 'localhost')
        port = env_vars.get('POSTGRES_PORT', '5432')
        username = env_vars.get('POSTGRES_USERNAME', 'postgres')
        password = env_vars.get('POSTGRES_PASSWORD', 'password')
        database = 'companion_intel'  # Standard development database name
        
        database_url = f"postgresql://{username}:{password}@{host}:{port}/{database}"
        
        # Use default user from env or provided user_id
        if user_id is None:
            # Generate a default test user ID
            user_id = "b3b8c7e2-1c2d-4e5f-8a6b-9c0d1e2f3a4b"
        
        print(f"📡 Connecting to database: {host}:{port}/{database}")
        print(f"👤 Using user ID: {user_id}")
        
        return cls(database_url, user_id)
        
    def connect_db(self):
        """Connect to PostgreSQL database"""
        return psycopg2.connect(self.database_url, cursor_factory=RealDictCursor)
    
    def generate_uuid(self) -> str:
        """Generate UUID v7 style ID"""
        return str(uuid.uuid4())
    
    def create_person_entity(
        self,
        first_name: str,
        last_name: str,
        system_user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a person entity with realistic properties"""
        entity_id = self.generate_uuid()
        properties = {
            "first_name": first_name,
            "last_name": last_name,
            "type": "Professional",
            "email": f"{first_name.lower()}.{last_name.lower()}@{random.choice(['gmail.com', 'company.com', 'tech.io'])}",
            "linkedin": f"linkedin.com/in/{first_name.lower()}-{last_name.lower()}",
            "skills": random.sample(["Python", "JavaScript", "React", "Node.js", "AI/ML", "Design", "Product Management"], 3)
        }

        if system_user_id:
            properties["user_id"] = system_user_id

        entity = {
            "entity_id": entity_id,
            "entity_type": "Person",
            "name": f"{first_name} {last_name}",
            "description": f"Professional in tech industry",
            "properties": properties,
            "search_content": f"{first_name} {last_name} {' '.join(properties['skills'])}",
            "is_active": True,
            "is_archived": False,
            "linked_table": "users" if system_user_id else None,
            "linked_id": system_user_id if system_user_id else None,
        }

        if system_user_id:
            self._user_entity_links.add((system_user_id, entity_id))

        self.entities.append(entity)
        return entity
    
    def create_location_entity(self, location_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a location entity"""
        entity_id = self.generate_uuid()
        properties = {
            "type": location_data["type"],
            "latitude": location_data["lat"],
            "longitude": location_data["lng"],
            "address": f"{location_data['name']}, USA"
        }
        
        entity = {
            "entity_id": entity_id,
            "entity_type": "Location",
            "name": location_data["name"],
            "description": f"{location_data['type']} located at {location_data['name']}",
            "properties": properties,
            "search_content": f"{location_data['name']} {location_data['type']}",
            "is_active": True,
            "is_archived": False
        }
        
        self.entities.append(entity)
        return entity
    
    def create_object_entity(self, object_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create an object entity"""
        entity_id = self.generate_uuid()
        
        entity = {
            "entity_id": entity_id,
            "entity_type": "Object",
            "name": object_data["name"],
            "description": f"{object_data['type']} - {object_data['name']}",
            "properties": object_data["properties"],
            "search_content": f"{object_data['name']} {object_data['type']}",
            "is_active": True,
            "is_archived": False
        }
        
        self.entities.append(entity)
        return entity
    
    def create_concept_entity(self, concept_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a concept entity with rich properties"""
        entity_id = self.generate_uuid()
        
        # Extract name, type, and description
        name = concept_data["name"]
        entity_type_value = concept_data["type"]
        description = concept_data.get("description", f"{entity_type_value}: {name}")
        
        # Copy all fields to properties, excluding name, type, and description
        # as they have dedicated columns
        properties = {k: v for k, v in concept_data.items() 
                     if k not in ["name", "description"]}
        
        # Build search content from all available text fields
        search_parts = [name, entity_type_value, description]
        
        # Add any list or string fields to search content
        for key, value in concept_data.items():
            if key not in ["name", "type", "description"]:
                if isinstance(value, list):
                    search_parts.extend([str(item) for item in value])
                elif isinstance(value, str):
                    search_parts.append(value)
        
        search_content = " ".join(search_parts)
        
        entity = {
            "entity_id": entity_id,
            "entity_type": "Concept",
            "name": name,
            "description": description,
            "properties": properties,
            "search_content": search_content,
            "is_active": True,
            "is_archived": False
        }
        
        self.entities.append(entity)
        return entity
    
    def create_company_entity(self, company_name: str) -> Dict[str, Any]:
        """Create a company entity"""
        entity_id = self.generate_uuid()
        properties = {
            "type": "Technology Company",
            "industry": "Software",
            "size": random.choice(["Startup", "Mid-size", "Enterprise"]),
            "website": f"https://{company_name.lower().replace(' ', '')}.com"
        }
        
        entity = {
            "entity_id": entity_id,
            "entity_type": "Organization",
            "name": company_name,
            "description": f"Technology company - {company_name}",
            "properties": properties,
            "search_content": f"{company_name} technology company software",
            "is_active": True,
            "is_archived": False
        }
        
        self.entities.append(entity)
        return entity
    
    def create_john_smith_family(self, system_user_id: str) -> List[Dict[str, Any]]:
        """Create John Smith and his family with realistic preferences for demo"""
        # Create family members
        john = self.create_family_member(
            "John", "Smith", 42, "father",
            system_user_id=system_user_id,
            bio="Software engineer and family man who loves organizing family activities",
            occupation="Software Engineer"
        )
        
        sarah = self.create_family_member(
            "Sarah", "Smith", 40, "mother",
            bio="Marketing manager with a passion for healthy living and outdoor activities",
            occupation="Marketing Manager"
        )
        
        emma = self.create_family_member(
            "Emma", "Smith", 14, "daughter",
            bio="High school student interested in art, music, and social causes",
            occupation="Student"
        )
        
        lucas = self.create_family_member(
            "Lucas", "Smith", 10, "son",
            bio="Elementary school student who loves sports, video games, and adventure",
            occupation="Student"
        )
        
        family_members = [john, sarah, emma, lucas]
        
        # Create family relationships
        self.create_family_relationships(john, sarah, emma, lucas)
        
        # Create home location
        home = self.create_home_location()
        
        # Link family members to home
        for member in family_members:
            self.create_relationship(member, home, "LIVES_IN", {
                "since": "2015-06-01",
                "relationship": "primary_residence"
            })
        
        # Store family members for later preference assignment
        self._family_members = {
            'john': john,
            'sarah': sarah,
            'emma': emma,
            'lucas': lucas
        }
        
        return family_members
    
    def create_family_member(self, first_name: str, last_name: str, age: int,
                            role: str, system_user_id: str = None, bio: str = None,
                            occupation: str = None) -> Dict[str, Any]:
        """Create a family member entity"""
        entity_id = self.generate_uuid()
        
        properties = {
            "first_name": first_name,
            "last_name": last_name,
            "age": age,
            "family_role": role,
            "occupation": occupation,
            "bio": bio
        }

        # Add email for adults
        if age >= 18:
            properties["email"] = f"{first_name.lower()}.{last_name.lower()}@family.com"

        if system_user_id:
            properties["user_id"] = system_user_id

        entity = {
            "entity_id": entity_id,
            "entity_type": "Person",
            "name": f"{first_name} {last_name}",
            "description": bio or f"{role.capitalize()} of the Smith family",
            "properties": properties,
            "search_content": f"{first_name} {last_name} {role} {occupation or ''}",
            "is_active": True,
            "is_archived": False,
            "linked_table": "users" if system_user_id else None,
            "linked_id": system_user_id if system_user_id else None
        }

        if system_user_id:
            self._user_entity_links.add((system_user_id, entity_id))

        self.entities.append(entity)
        return entity
    
    def create_family_relationships(self, john, sarah, emma, lucas):
        """Create family relationship network"""
        # Marriage
        self.create_relationship(john, sarah, "SPOUSE", {
            "married_since": "2008-06-15",
            "anniversary": "June 15"
        })
        self.create_relationship(sarah, john, "SPOUSE", {
            "married_since": "2008-06-15",
            "anniversary": "June 15"
        })
        
        # Parent-child relationships
        for parent in [john, sarah]:
            for child, rel_type in [(emma, "daughter"), (lucas, "son")]:
                parent_type = "father" if parent == john else "mother"
                self.create_relationship(parent, child, "PARENT_OF", {
                    "relationship": f"{parent_type}-{rel_type}",
                    "since_birth": True
                })
                self.create_relationship(child, parent, "CHILD_OF", {
                    "parent": parent_type
                })
        
        # Sibling relationships
        self.create_relationship(emma, lucas, "SIBLING_OF", {
            "relationship": "older_sister",
            "age_gap": 4
        })
        self.create_relationship(lucas, emma, "SIBLING_OF", {
            "relationship": "younger_brother",
            "age_gap": 4
        })
    
    def create_home_location(self) -> Dict[str, Any]:
        """Create the family home location"""
        entity_id = self.generate_uuid()
        
        entity = {
            "entity_id": entity_id,
            "entity_type": "Location",
            "name": "Smith Family Home",
            "description": "Family residence in a quiet suburban neighborhood",
            "properties": {
                "type": "Residence",
                "latitude": 33.5427,
                "longitude": 117.7854,
                "address": "123 Maple Street, Laguna Beach, CA",
                "bedrooms": 4,
                "neighborhood": "Generic area"
            },
            "search_content": "Smith Family Home residence in LA",
            "is_active": True,
            "is_archived": False
        }
        
        self.entities.append(entity)
        return entity
    
    def create_relationship(self, from_entity: Dict, to_entity: Dict, relationship_type: str, 
                          properties: Dict[str, Any] = None) -> Dict[str, Any]:
        """Create a relationship between two entities"""
        relationship_id = self.generate_uuid()
        
        relationship = {
            "relationship_id": relationship_id,
            "from_entity_id": from_entity["entity_id"],
            "to_entity_id": to_entity["entity_id"],
            "relationship_type": relationship_type,
            "strength": random.uniform(0.6, 1.0),
            "properties": properties or {},
            "is_active": True,
            "is_bidirectional": relationship_type in ["KNOWS", "WORKS_WITH", "COLLABORATED_WITH"]
        }
        
        self.relationships.append(relationship)
        return relationship
    
    def generate_test_data(self, num_people: int = 20, num_companies: int = 5, 
                          include_family: bool = False, family_user_id: str = None):
        """Generate comprehensive test data"""
        print(f"Generating test data for user {self.user_id}...")
        
        people = []
        
        # Create John Smith family if requested
        if include_family:
            print("\n👨‍👩‍👧‍👦 Creating John Smith family...")
            family_members = self.create_john_smith_family(family_user_id or self.user_id)
            people.extend(family_members)
            print(f"✅ Created Smith family: {len(family_members)} members")
        
        # Create additional random people
        remaining_people = num_people - len(people)
        if remaining_people > 0:
            print(f"\n👥 Creating {remaining_people} additional people...")
            for _ in range(remaining_people):
                first_name = random.choice(FIRST_NAMES)
                last_name = random.choice(LAST_NAMES)
                person = self.create_person_entity(first_name, last_name)
                people.append(person)
        
        # Create locations
        locations = []
        for location_data in LOCATIONS:
            location = self.create_location_entity(location_data)
            locations.append(location)
        
        # Create companies
        companies = []
        for _ in range(num_companies):
            company_name = random.choice(COMPANIES)
            company = self.create_company_entity(company_name)
            companies.append(company)
        
        # Create objects
        objects = []
        for object_data in OBJECTS:
            obj = self.create_object_entity(object_data)
            objects.append(obj)
        
        # Create general concepts (interests)
        concepts = []
        for concept_data in CONCEPTS:
            concept = self.create_concept_entity(concept_data)
            concepts.append(concept)
        
        # Create preference concepts
        preferences = []
        
        # Food preferences
        for pref_data in FOOD_PREFERENCES:
            pref = self.create_concept_entity(pref_data)
            preferences.append(pref)
        
        # Movie preferences
        for pref_data in MOVIE_PREFERENCES:
            pref = self.create_concept_entity(pref_data)
            preferences.append(pref)
        
        # Music preferences
        for pref_data in MUSIC_PREFERENCES:
            pref = self.create_concept_entity(pref_data)
            preferences.append(pref)
        
        # Activity preferences
        for pref_data in ACTIVITY_PREFERENCES:
            pref = self.create_concept_entity(pref_data)
            preferences.append(pref)
        
        # Drink preferences
        for pref_data in DRINK_PREFERENCES:
            pref = self.create_concept_entity(pref_data)
            preferences.append(pref)
        
        # Generate relationships
        self.generate_relationships(people, locations, companies, objects, concepts, preferences, 
                                   include_family=include_family)
        
        print(f"\nGenerated {len(self.entities)} entities and {len(self.relationships)} relationships")
    
    def generate_relationships(self, people: List[Dict], locations: List[Dict], 
                             companies: List[Dict], objects: List[Dict], concepts: List[Dict],
                             preferences: List[Dict], include_family: bool = False):
        """Generate realistic relationships between entities"""
        
        # Keep track of created relationships to avoid duplicates
        created_relationships = set()
        
        def add_relationship_if_unique(from_entity, to_entity, rel_type, properties=None):
            """Add relationship only if it doesn't already exist"""
            # Create a key to check for duplicates (consider bidirectional relationships)
            if rel_type in ["KNOWS", "WORKS_WITH", "COLLABORATED_WITH"]:
                # For bidirectional relationships, create a consistent key regardless of direction
                entities = sorted([from_entity["entity_id"], to_entity["entity_id"]])
                key = (entities[0], entities[1], rel_type)
            else:
                # For directional relationships, use the exact direction
                key = (from_entity["entity_id"], to_entity["entity_id"], rel_type)
            
            if key not in created_relationships:
                created_relationships.add(key)
                self.create_relationship(from_entity, to_entity, rel_type, properties)
                return True
            return False
        
        # If family is included, assign their curated preferences first
        family_people = []
        non_family_people = people.copy()
        
        if include_family and hasattr(self, '_family_members'):
            print("\n🎯 Assigning curated family preferences...")
            family_people = list(self._family_members.values())
            # Remove family from non_family list
            family_ids = {fm["entity_id"] for fm in family_people}
            non_family_people = [p for p in people if p["entity_id"] not in family_ids]
            
            # Assign specific preferences to each family member
            self.assign_family_preferences(preferences)
        
        # People know each other
        for i, person1 in enumerate(people):
            # Each person knows 3-7 other people
            num_connections = random.randint(3, 7)
            attempts = 0
            connections_made = 0
            
            while connections_made < num_connections and attempts < num_connections * 2:
                person2 = random.choice(people[:i] + people[i+1:])  # Exclude self
                if add_relationship_if_unique(person1, person2, "KNOWS", {
                    "since": (datetime.now() - timedelta(days=random.randint(30, 1095))).isoformat(),
                    "context": random.choice(["work", "school", "social", "professional"])
                }):
                    connections_made += 1
                attempts += 1
        
        # People work at companies
        for person in people:
            if random.random() < 0.8:  # 80% of people work at companies
                company = random.choice(companies)
                add_relationship_if_unique(person, company, "WORKED_AT", {
                    "position": random.choice(["Engineer", "Designer", "Manager", "Analyst", "Consultant"]),
                    "start_date": (datetime.now() - timedelta(days=random.randint(90, 1460))).isoformat()
                })
        
        # People live in or visit locations
        for person in people:
            # Each person lives in one location
            home_location = random.choice(locations[:5])  # Cities only
            add_relationship_if_unique(person, home_location, "LIVES_IN", {
                "since": (datetime.now() - timedelta(days=random.randint(365, 2920))).isoformat()
            })
            
            # People visit other locations
            for _ in range(random.randint(2, 5)):
                visited_location = random.choice(locations)
                if visited_location != home_location:
                    add_relationship_if_unique(person, visited_location, "VISITED", {
                        "date": (datetime.now() - timedelta(days=random.randint(1, 365))).isoformat(),
                        "purpose": random.choice(["vacation", "business", "conference", "personal"])
                    })
        
        # People own objects
        for person in people:
            num_objects = random.randint(2, 4)
            person_objects = random.sample(objects, min(num_objects, len(objects)))
            for obj in person_objects:
                add_relationship_if_unique(person, obj, "OWNS", {
                    "acquired_date": (datetime.now() - timedelta(days=random.randint(30, 730))).isoformat(),
                    "condition": random.choice(["new", "used", "refurbished"])
                })
        
        # People are interested in concepts
        for person in people:
            num_interests = random.randint(2, 4)
            person_interests = random.sample(concepts, min(num_interests, len(concepts)))
            for concept in person_interests:
                add_relationship_if_unique(person, concept, "INTERESTED_IN", {
                    "level": random.choice(["beginner", "intermediate", "advanced", "expert"]),
                    "since": (datetime.now() - timedelta(days=random.randint(90, 1095))).isoformat()
                })
        
        # Some people collaborate with each other
        for _ in range(random.randint(5, 10)):
            if len(people) >= 2:
                person1, person2 = random.sample(people, 2)
                add_relationship_if_unique(person1, person2, "COLLABORATED_WITH", {
                    "project": f"Project {random.choice(['Alpha', 'Beta', 'Gamma', 'Delta'])}",
                    "duration": f"{random.randint(1, 12)} months",
                    "type": random.choice(["software", "research", "design", "consulting"])
                })
        
        # People have preferences (15-25 preferences per person)
        # Family members already have curated preferences, so only assign to non-family
        people_needing_prefs = non_family_people if include_family else people
        
        if people_needing_prefs:
            print("Generating preference relationships...")
            for person in people_needing_prefs:
                # PREFERS relationships (15-25 per person)
                num_preferences = random.randint(15, 25)
                # Sample random preferences to ensure variety
                selected_prefs = random.sample(preferences, min(num_preferences, len(preferences)))
                
                for pref in selected_prefs:
                    # Generate preference strength (0.3 to 1.0)
                    # Higher strength = stronger preference
                    strength = round(random.uniform(0.3, 1.0), 2)
                    
                    # Some preferences have been around longer
                    days_since = random.randint(30, 2190)  # 1 month to 6 years
                    
                    add_relationship_if_unique(person, pref, "PREFERS", {
                        "strength": strength,
                        "since": (datetime.now() - timedelta(days=days_since)).isoformat(),
                        "context": random.choice(["discovered", "childhood", "recent", "always loved", "acquired taste"])
                    })
                
                # DISLIKES relationships (3-8 per person)
                # Get preferences not already linked with PREFERS
                remaining_prefs = [p for p in preferences if p not in selected_prefs]
                if remaining_prefs:
                    num_dislikes = random.randint(3, min(8, len(remaining_prefs)))
                    disliked_prefs = random.sample(remaining_prefs, num_dislikes)
                    
                    for pref in disliked_prefs:
                        # Generate dislike strength (0.3 to 1.0)
                        # Higher strength = stronger dislike
                        strength = round(random.uniform(0.3, 1.0), 2)
                        
                        days_since = random.randint(30, 2190)
                        
                        add_relationship_if_unique(person, pref, "DISLIKES", {
                            "strength": strength,
                            "since": (datetime.now() - timedelta(days=days_since)).isoformat(),
                            "reason": random.choice(["bad experience", "never appealed", "tried once", "health reasons", "personal taste"])
                        })
    
    def find_pref(self, pref_list: List[Dict], name: str) -> Dict[str, Any]:
        """Find a preference by name"""
        for pref in pref_list:
            if pref["name"] == name:
                return pref
        return None
    
    def add_preference(self, person: Dict, preference: Dict, strength: float, context: str = "always loved"):
        """Helper to add a preference with strength"""
        if preference is None:
            return
        days_since = random.randint(365, 3650)  # 1-10 years
        self.create_relationship(person, preference, "PREFERS", {
            "strength": strength,
            "since": (datetime.now() - timedelta(days=days_since)).isoformat(),
            "context": context
        })
    
    def add_dislike(self, person: Dict, preference: Dict, strength: float, reason: str = "personal taste"):
        """Helper to add a dislike with strength"""
        if preference is None:
            return
        days_since = random.randint(365, 3650)  # 1-10 years
        self.create_relationship(person, preference, "DISLIKES", {
            "strength": strength,
            "since": (datetime.now() - timedelta(days=days_since)).isoformat(),
            "reason": reason
        })
    
    def assign_family_preferences(self, preferences: List[Dict]):
        """Assign curated preferences to Smith family members"""
        # Group preferences by type for easy lookup
        # Note: checking the properties dict which contains the 'type' field
        food_prefs = [p for p in preferences if p["properties"]["type"] in ["food", "cuisine", "dietary_preference", "food_category"]]
        movie_prefs = [p for p in preferences if p["properties"]["type"] == "movie_genre"]
        music_prefs = [p for p in preferences if p["properties"]["type"] == "music_genre"]
        activity_prefs = [p for p in preferences if p["properties"]["type"] == "activity"]
        drink_prefs = [p for p in preferences if p["properties"]["type"] == "beverage"]
        
        john = self._family_members['john']
        sarah = self._family_members['sarah']
        emma = self._family_members['emma']
        lucas = self._family_members['lucas']
        
        # John - balanced, adult tastes
        self.add_preference(john, self.find_pref(food_prefs, "Italian Cuisine"), 0.9, "childhood")
        self.add_preference(john, self.find_pref(food_prefs, "Pizza"), 0.85, "always loved")
        self.add_preference(john, self.find_pref(food_prefs, "BBQ"), 0.8, "discovered")
        self.add_preference(john, self.find_pref(food_prefs, "Thai Food"), 0.75, "acquired taste")
        self.add_preference(john, self.find_pref(food_prefs, "Sushi"), 0.7, "recent")
        self.add_preference(john, self.find_pref(movie_prefs, "Sci-Fi"), 0.95, "always loved")
        self.add_preference(john, self.find_pref(movie_prefs, "Action"), 0.85, "always loved")
        self.add_preference(john, self.find_pref(movie_prefs, "Thriller"), 0.8, "discovered")
        self.add_preference(john, self.find_pref(movie_prefs, "Drama"), 0.65, "acquired taste")
        self.add_preference(john, self.find_pref(activity_prefs, "Hiking"), 0.8, "discovered")
        self.add_preference(john, self.find_pref(activity_prefs, "Reading"), 0.75, "childhood")
        self.add_preference(john, self.find_pref(activity_prefs, "Cycling"), 0.7, "recent")
        self.add_preference(john, self.find_pref(drink_prefs, "Coffee"), 0.95, "always loved")
        self.add_preference(john, self.find_pref(drink_prefs, "Beer"), 0.7, "discovered")
        
        # Sarah - health-conscious, sophisticated
        self.add_preference(sarah, self.find_pref(food_prefs, "Mediterranean"), 0.95, "acquired taste")
        self.add_preference(sarah, self.find_pref(food_prefs, "Thai Food"), 0.9, "always loved")
        self.add_preference(sarah, self.find_pref(food_prefs, "Vegetarian"), 0.85, "discovered")
        self.add_preference(sarah, self.find_pref(food_prefs, "Sushi"), 0.8, "acquired taste")
        self.add_preference(sarah, self.find_pref(food_prefs, "Italian Cuisine"), 0.75, "childhood")
        self.add_preference(sarah, self.find_pref(movie_prefs, "Drama"), 0.9, "always loved")
        self.add_preference(sarah, self.find_pref(movie_prefs, "Romance"), 0.85, "always loved")
        self.add_preference(sarah, self.find_pref(movie_prefs, "Documentary"), 0.8, "acquired taste")
        self.add_preference(sarah, self.find_pref(movie_prefs, "Comedy"), 0.75, "discovered")
        self.add_preference(sarah, self.find_pref(activity_prefs, "Yoga"), 0.95, "discovered")
        self.add_preference(sarah, self.find_pref(activity_prefs, "Running"), 0.85, "recent")
        self.add_preference(sarah, self.find_pref(activity_prefs, "Reading"), 0.8, "childhood")
        self.add_preference(sarah, self.find_pref(activity_prefs, "Painting"), 0.7, "recent")
        self.add_preference(sarah, self.find_pref(drink_prefs, "Tea"), 0.9, "always loved")
        self.add_preference(sarah, self.find_pref(drink_prefs, "Wine"), 0.85, "acquired taste")
        self.add_preference(sarah, self.find_pref(drink_prefs, "Smoothies"), 0.8, "discovered")
        
        # Emma - teenage girl, artistic, social
        self.add_preference(emma, self.find_pref(food_prefs, "Pizza"), 0.95, "always loved")
        self.add_preference(emma, self.find_pref(food_prefs, "Mexican Food"), 0.9, "always loved")
        self.add_preference(emma, self.find_pref(food_prefs, "Sushi"), 0.85, "discovered")
        self.add_preference(emma, self.find_pref(food_prefs, "Italian Cuisine"), 0.8, "childhood")
        self.add_preference(emma, self.find_pref(food_prefs, "Thai Food"), 0.7, "recent")
        self.add_preference(emma, self.find_pref(movie_prefs, "Animation"), 0.9, "childhood")
        self.add_preference(emma, self.find_pref(movie_prefs, "Romance"), 0.85, "discovered")
        self.add_preference(emma, self.find_pref(movie_prefs, "Comedy"), 0.85, "always loved")
        self.add_preference(emma, self.find_pref(movie_prefs, "Drama"), 0.75, "recent")
        self.add_preference(emma, self.find_pref(activity_prefs, "Painting"), 0.95, "discovered")
        self.add_preference(emma, self.find_pref(activity_prefs, "Reading"), 0.85, "childhood")
        self.add_preference(emma, self.find_pref(activity_prefs, "Dancing"), 0.8, "recent")
        self.add_preference(emma, self.find_pref(activity_prefs, "Writing"), 0.75, "recent")
        self.add_preference(emma, self.find_pref(drink_prefs, "Smoothies"), 0.9, "always loved")
        self.add_preference(emma, self.find_pref(drink_prefs, "Tea"), 0.7, "discovered")
        
        # Lucas - 10 year old boy, energetic, playful
        self.add_preference(lucas, self.find_pref(food_prefs, "Pizza"), 1.0, "always loved")
        self.add_preference(lucas, self.find_pref(food_prefs, "Tacos"), 0.95, "always loved")
        self.add_preference(lucas, self.find_pref(food_prefs, "BBQ"), 0.9, "always loved")
        self.add_preference(lucas, self.find_pref(food_prefs, "Chinese Food"), 0.85, "discovered")
        self.add_preference(lucas, self.find_pref(food_prefs, "Italian Cuisine"), 0.75, "childhood")
        self.add_preference(lucas, self.find_pref(movie_prefs, "Animation"), 1.0, "always loved")
        self.add_preference(lucas, self.find_pref(movie_prefs, "Action"), 0.95, "discovered")
        self.add_preference(lucas, self.find_pref(movie_prefs, "Sci-Fi"), 0.9, "discovered")
        self.add_preference(lucas, self.find_pref(movie_prefs, "Comedy"), 0.85, "always loved")
        self.add_preference(lucas, self.find_pref(activity_prefs, "Gaming"), 1.0, "always loved")
        self.add_preference(lucas, self.find_pref(activity_prefs, "Swimming"), 0.95, "childhood")
        self.add_preference(lucas, self.find_pref(activity_prefs, "Cycling"), 0.9, "discovered")
        self.add_preference(lucas, self.find_pref(activity_prefs, "Hiking"), 0.8, "recent")
        self.add_preference(lucas, self.find_pref(drink_prefs, "Smoothies"), 0.95, "always loved")
        
        # Add some curated dislikes for each family member
        # John dislikes
        self.add_dislike(john, self.find_pref(movie_prefs, "Horror"), 0.9, "too scary")
        self.add_dislike(john, self.find_pref(food_prefs, "Seafood"), 0.7, "allergies")
        self.add_dislike(john, self.find_pref(activity_prefs, "Dancing"), 0.6, "not my thing")
        
        # Sarah dislikes
        self.add_dislike(sarah, self.find_pref(movie_prefs, "Horror"), 0.85, "too intense")
        self.add_dislike(sarah, self.find_pref(food_prefs, "BBQ"), 0.7, "health reasons")
        self.add_dislike(sarah, self.find_pref(drink_prefs, "Beer"), 0.8, "taste preference")
        
        # Emma dislikes
        self.add_dislike(emma, self.find_pref(movie_prefs, "Horror"), 1.0, "nightmares")
        self.add_dislike(emma, self.find_pref(food_prefs, "Seafood"), 0.9, "texture issues")
        self.add_dislike(emma, self.find_pref(activity_prefs, "Running"), 0.7, "prefer other activities")
        
        # Lucas dislikes
        self.add_dislike(lucas, self.find_pref(food_prefs, "Vegetarian"), 0.85, "likes meat")
        self.add_dislike(lucas, self.find_pref(food_prefs, "Seafood"), 0.95, "yuck!")
        self.add_dislike(lucas, self.find_pref(movie_prefs, "Romance"), 0.9, "boring")
        self.add_dislike(lucas, self.find_pref(activity_prefs, "Yoga"), 0.8, "too slow")
    
    def save_to_database(self):
        """Save generated data to PostgreSQL database"""
        print("Connecting to database...")
        
        with self.connect_db() as conn:
            with conn.cursor() as cur:
                # Insert entities
                print(f"Inserting {len(self.entities)} entities...")
                for entity in self.entities:
                    cur.execute("""
                        INSERT INTO entities (
                            entity_id, entity_type, name, description, properties,
                            search_content, linked_table, linked_id,
                            is_active, is_archived, created_at, updated_at, last_accessed
                        ) VALUES (
                            %(entity_id)s, %(entity_type)s, %(name)s, %(description)s, %(properties)s,
                            %(search_content)s, %(linked_table)s, %(linked_id)s,
                            %(is_active)s, %(is_archived)s, NOW(), NOW(), NOW()
                        ) ON CONFLICT (entity_id) DO NOTHING
                    """, {
                        **entity,
                        "properties": json.dumps(entity["properties"]),
                        "linked_table": entity.get("linked_table"),
                        "linked_id": entity.get("linked_id"),
                    })
                
                # Insert relationships
                print(f"Inserting {len(self.relationships)} relationships...")
                for rel in self.relationships:
                    cur.execute("""
                        INSERT INTO relationships (
                            relationship_id, from_entity_id, to_entity_id, relationship_type,
                            strength, properties, is_bidirectional, is_active, created_at, updated_at
                        ) VALUES (
                            %(relationship_id)s, %(from_entity_id)s, %(to_entity_id)s, %(relationship_type)s,
                            %(strength)s, %(properties)s, %(is_bidirectional)s, %(is_active)s, NOW(), NOW()
                        ) ON CONFLICT (relationship_id) DO NOTHING
                    """, {
                        **rel,
                        "properties": json.dumps(rel["properties"])
                    })

                if self._user_entity_links:
                    print("Updating user entity links...")
                    for user_id, entity_id in self._user_entity_links:
                        cur.execute(
                            """
                                UPDATE users
                                SET entity_id = %s
                                WHERE id = %s AND (entity_id IS NULL OR entity_id <> %s)
                            """,
                            (entity_id, user_id, entity_id),
                        )

                cur.execute(
                    """
                        UPDATE users u
                        SET entity_id = e.entity_id
                        FROM entities e
                        WHERE e.linked_table = 'users'
                          AND e.linked_id = u.id
                          AND (u.entity_id IS NULL OR u.entity_id <> e.entity_id)
                    """
                )

                conn.commit()
                print("✅ Test data saved successfully!")
    
    def generate_summary(self):
        """Print a summary of generated data"""
        entity_types = {}
        for entity in self.entities:
            entity_type = entity["entity_type"]
            entity_types[entity_type] = entity_types.get(entity_type, 0) + 1
        
        relationship_types = {}
        for rel in self.relationships:
            rel_type = rel["relationship_type"]
            relationship_types[rel_type] = relationship_types.get(rel_type, 0) + 1
        
        print("\n📊 Data Generation Summary:")
        print("=" * 40)
        print("Entities:")
        for entity_type, count in sorted(entity_types.items()):
            print(f"  {entity_type}: {count}")
        
        print("\nRelationships:")
        for rel_type, count in sorted(relationship_types.items()):
            print(f"  {rel_type}: {count}")
        
        print(f"\nTotal: {len(self.entities)} entities, {len(self.relationships)} relationships")


def main():
    parser = argparse.ArgumentParser(description="Generate test data for CI-Server graph system")
    parser.add_argument(
        "--env-file",
        help="Path to .env file (default: auto-detect from CI-Server root)"
    )
    parser.add_argument(
        "--user-id",
        help="User ID to associate with generated data (default: test user)"
    )
    parser.add_argument(
        "--num-people",
        type=int,
        default=20,
        help="Number of people to generate (includes family if --family flag used)"
    )
    parser.add_argument(
        "--num-companies",
        type=int,
        default=5,
        help="Number of companies to generate"
    )
    parser.add_argument(
        "--family",
        action="store_true",
        help="Include John Smith family with curated preferences for 'dinner and a movie' demo"
    )
    parser.add_argument(
        "--family-user-id",
        help="Specific user ID to link John Smith to (defaults to --user-id)"
    )
    
    args = parser.parse_args()
    
    try:
        generator = GraphDataGenerator.from_env_file(args.env_file, args.user_id)
        
        # Generate test data
        generator.generate_test_data(
            args.num_people, 
            args.num_companies,
            include_family=args.family,
            family_user_id=args.family_user_id
        )
        
        generator.generate_summary()
        
        # Show family info if included
        if args.family:
            print("\n" + "="*60)
            print("👨‍👩‍👧‍👦 John Smith Family Demo Data:")
            print("="*60)
            print("  - John Smith (42) - Father, Software Engineer")
            print("  - Sarah Smith (40) - Mother, Marketing Manager")
            print("  - Emma Smith (14) - Daughter, High School Student")
            print("  - Lucas Smith (10) - Son, Elementary Student")
            print("\n🔗 Family relationships: SPOUSE, PARENT_OF, CHILD_OF, SIBLING_OF")
            print("🎯 Curated preferences for 'dinner and a movie' coordination demo")
            print("📍 Location: Smith Family Home, Somerville, MA")
            if args.family_user_id or args.user_id:
                print(f"👤 John Smith linked to user: {args.family_user_id or args.user_id}")
        
        generator.save_to_database()
        
        print("\n🎉 Graph test data generation complete!")
        print("You can now test the frontend with this realistic graph data.")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())
