import * as concepts from '../concepts';
import * as people from '../people';

import { RelationshipType, type SeedRelationship } from './types';

export const ASSOCIATE_PREFERENCES: SeedRelationship[] = [
  // ==========================================
  // JOHN'S FRIENDS
  // ==========================================
  // Tom Wilson: Endurance Hiking, Structural Design, Craft Beer
  {
    fromNodeId: people.TOM_WILSON.id,
    toNodeId: concepts.HIKING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'hobby',
    },
  },
  {
    fromNodeId: people.TOM_WILSON.id,
    toNodeId: concepts.ARCHITECTURE.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'profession',
    },
  },
  {
    fromNodeId: people.TOM_WILSON.id,
    toNodeId: concepts.BEER.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'interest',
    },
  },

  // Chris Martin: Road Cycling, Triathlon Training
  {
    fromNodeId: people.CHRIS_MARTIN.id,
    toNodeId: concepts.CYCLING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'hobby',
    },
  },
  {
    fromNodeId: people.CHRIS_MARTIN.id,
    toNodeId: concepts.RUNNING.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'training',
    },
  },
  {
    fromNodeId: people.CHRIS_MARTIN.id,
    toNodeId: concepts.SWIMMING.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'training',
    },
  },

  // Mark Thompson: Home Brewing, BBQ
  {
    fromNodeId: people.MARK_THOMPSON.id,
    toNodeId: concepts.BEER.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'passion',
    },
  },
  {
    fromNodeId: people.MARK_THOMPSON.id,
    toNodeId: concepts.BBQ.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'science',
    },
  },

  // Laura Garcia: Literary Fiction, Tea
  {
    fromNodeId: people.LAURA_GARCIA.id,
    toNodeId: concepts.READING.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'profession/hobby',
    },
  },
  {
    fromNodeId: people.LAURA_GARCIA.id,
    toNodeId: concepts.TEA.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'ritual',
    },
  },

  // Steve Miller: Bicycle Mechanics, Wine
  {
    fromNodeId: people.STEVE_MILLER.id,
    toNodeId: concepts.CYCLING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'mechanics',
    },
  },
  {
    fromNodeId: people.STEVE_MILLER.id,
    toNodeId: concepts.WINE.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'hobby',
    },
  },

  // Paul Anderson: Espresso, Philosophy, Chess
  {
    fromNodeId: people.PAUL_ANDERSON.id,
    toNodeId: concepts.ESPRESSO.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'ritual',
    },
  },
  {
    fromNodeId: people.PAUL_ANDERSON.id,
    toNodeId: concepts.PHILOSOPHY.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'interest',
    },
  },
  {
    fromNodeId: people.PAUL_ANDERSON.id,
    toNodeId: concepts.CHESS.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'hobby',
    },
  },

  // ==========================================
  // JOHN'S COWORKERS
  // ==========================================
  // David Chen: Code Architecture, Specialty Coffee
  {
    fromNodeId: people.DAVID_CHEN.id,
    toNodeId: concepts.SOFTWARE_ENGINEERING.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'profession',
    },
  },
  {
    fromNodeId: people.DAVID_CHEN.id,
    toNodeId: concepts.COFFEE.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'snob',
    },
  },

  // Michael Chang: System Scalability, Sci-Fi Novels
  {
    fromNodeId: people.MICHAEL_CHANG.id,
    toNodeId: concepts.SCIFI.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'hobby',
    },
  },

  // Rachel Green: Agile Methodology, Meditation
  {
    fromNodeId: people.RACHEL_GREEN.id,
    toNodeId: concepts.MEDITATION.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'mindfulness',
    },
  },

  // ==========================================
  // SARAH'S FRIENDS
  // ==========================================
  // Maya Patel: Meditation, Ayurveda, Hiking
  {
    fromNodeId: people.MAYA_PATEL.id,
    toNodeId: concepts.MEDITATION.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'profession',
    },
  },
  {
    fromNodeId: people.MAYA_PATEL.id,
    toNodeId: concepts.HIKING.id,
    type: RelationshipType.PREFERS,
    strength: 0.7,
    properties: {
      context: 'hobby',
    },
  },

  // Nina Kovac: Sculpture, Gardening, Jazz
  {
    fromNodeId: people.NINA_KOVAC.id,
    toNodeId: concepts.POTTERY.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'profession',
    },
  },
  {
    fromNodeId: people.NINA_KOVAC.id,
    toNodeId: concepts.GARDENING.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'hobby',
    },
  },
  {
    fromNodeId: people.NINA_KOVAC.id,
    toNodeId: concepts.JAZZ.id,
    type: RelationshipType.PREFERS,
    strength: 0.75,
    properties: {
      context: 'music',
    },
  },

  // Rebecca Lewis: Psychology, Coffee
  {
    fromNodeId: people.REBECCA_LEWIS.id,
    toNodeId: concepts.PSYCHOLOGY.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'profession',
    },
  },

  // David Wu: Golf, Business Strategy
  {
    fromNodeId: people.DAVID_WU.id,
    toNodeId: concepts.GOLF.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'hobby',
    },
  },

  // Karen Vos: Gardening, Baking
  {
    fromNodeId: people.KAREN_VOS.id,
    toNodeId: concepts.GARDENING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'passion',
    },
  },
  {
    fromNodeId: people.KAREN_VOS.id,
    toNodeId: concepts.BAKING.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'hobby',
    },
  },

  // ==========================================
  // SARAH'S COWORKERS
  // ==========================================
  // Julian Thorne: Abstract Art, Typography, Espresso
  {
    fromNodeId: people.JULIAN_THORNE.id,
    toNodeId: concepts.DESIGN.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'profession',
    },
  },
  {
    fromNodeId: people.JULIAN_THORNE.id,
    toNodeId: concepts.ESPRESSO.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'fuel',
    },
  },

  // Daniel Kim: Big Data, Excel, Chess
  {
    fromNodeId: people.DANIEL_KIM.id,
    toNodeId: concepts.CHESS.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'hobby',
    },
  },

  // Aisha Jones: Photography
  {
    fromNodeId: people.AISHA_JONES.id,
    toNodeId: concepts.PHOTOGRAPHY.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'hobby',
    },
  },
  {
    fromNodeId: people.AISHA_JONES.id,
    toNodeId: concepts.SOCIAL_MEDIA.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'profession',
    },
  },

  // ==========================================
  // EMMA'S FRIENDS
  // ==========================================
  // Zoe Richards: Activism, Environmental Science
  {
    fromNodeId: people.ZOE_RICHARDS.id,
    toNodeId: concepts.ACTIVISM.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'passion',
    },
  },
  {
    fromNodeId: people.ZOE_RICHARDS.id,
    toNodeId: concepts.SUSTAINABLE_LIVING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'value',
    },
  },

  // Mia Wong: Digital Art, Poetry
  {
    fromNodeId: people.MIA_WONG.id,
    toNodeId: concepts.PAINTING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'digital art',
    },
  },
  {
    fromNodeId: people.MIA_WONG.id,
    toNodeId: concepts.READING.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'poetry',
    },
  },

  // Oliver Cross: Theater, Musical Theater
  {
    fromNodeId: people.OLIVER_CROSS.id,
    toNodeId: concepts.THEATER.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'passion',
    },
  },

  // Sophia Lee: Pop Music, Baking
  {
    fromNodeId: people.SOPHIA_LEE.id,
    toNodeId: concepts.POP.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'music',
    },
  },
  {
    fromNodeId: people.SOPHIA_LEE.id,
    toNodeId: concepts.BAKING.id,
    type: RelationshipType.PREFERS,
    strength: 0.75,
    properties: {
      context: 'hobby',
    },
  },

  // Harper Vance: Punk Rock, Skateboarding
  {
    fromNodeId: people.HARPER_VANCE.id,
    toNodeId: concepts.SKATEBOARDING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'lifestyle',
    },
  },
  {
    fromNodeId: people.HARPER_VANCE.id,
    toNodeId: concepts.ROCK.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'music',
    },
  },

  // Aiden Brooks: Philosophy, Chess
  {
    fromNodeId: people.AIDEN_BROOKS.id,
    toNodeId: concepts.PHILOSOPHY.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'interest',
    },
  },
  {
    fromNodeId: people.AIDEN_BROOKS.id,
    toNodeId: concepts.CHESS.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'hobby',
    },
  },

  // Isabella Gomez: Psychology, Volunteering
  {
    fromNodeId: people.ISABELLA_GOMEZ.id,
    toNodeId: concepts.VOLUNTEERING.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'passion',
    },
  },
  {
    fromNodeId: people.ISABELLA_GOMEZ.id,
    toNodeId: concepts.PSYCHOLOGY.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'interest',
    },
  },

  // Jackson Hayes: Guitar, Indie Music
  {
    fromNodeId: people.JACKSON_HAYES.id,
    toNodeId: concepts.INDIE.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'music',
    },
  },
  {
    fromNodeId: people.JACKSON_HAYES.id,
    toNodeId: concepts.PHOTOGRAPHY.id,
    type: RelationshipType.PREFERS,
    strength: 0.75,
    properties: {
      context: 'hobby',
    },
  },

  // ==========================================
  // LUCAS'S FRIENDS
  // ==========================================
  // Leo Ricci: Soccer, Video Games
  {
    fromNodeId: people.LEO_RICCI.id,
    toNodeId: concepts.SOCCER.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'sport',
    },
  },
  {
    fromNodeId: people.LEO_RICCI.id,
    toNodeId: concepts.GAMING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'hobby',
    },
  },

  // Max Carter: Lego, Robotics
  {
    fromNodeId: people.MAX_CARTER.id,
    toNodeId: concepts.LEGO.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'passion',
    },
  },
  {
    fromNodeId: people.MAX_CARTER.id,
    toNodeId: concepts.ROBOTICS.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'hobby',
    },
  },

  // Ethan Wright: Camping
  {
    fromNodeId: people.ETHAN_WRIGHT.id,
    toNodeId: concepts.CAMPING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'hobby',
    },
  },

  // Caleb Davis: Hiking
  {
    fromNodeId: people.CALEB_DAVIS.id,
    toNodeId: concepts.HIKING.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'family activity',
    },
  },

  // Mason Hall: Competitive Sports
  {
    fromNodeId: people.MASON_HALL.id,
    toNodeId: concepts.SOCCER.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'sport',
    },
  },
  {
    fromNodeId: people.MASON_HALL.id,
    toNodeId: concepts.RUNNING.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'training',
    },
  },

  // Jayden Foster: Swimming
  {
    fromNodeId: people.JAYDEN_FOSTER.id,
    toNodeId: concepts.SWIMMING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'summer',
    },
  },

  // ==========================================
  // JOHN'S REMAINING ASSOCIATES
  // ==========================================
  // Jessica Lee
  {
    fromNodeId: people.JESSICA_LEE.id,
    toNodeId: concepts.GARDENING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'community',
    },
  },
  // Amanda Brown
  {
    fromNodeId: people.AMANDA_BROWN.id,
    toNodeId: concepts.WRITING.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'creative',
    },
  },
  {
    fromNodeId: people.AMANDA_BROWN.id,
    toNodeId: concepts.POLITICS.id,
    type: RelationshipType.PREFERS,
    strength: 0.6,
    properties: {
      context: 'local board',
    },
  },
  // Brian Wilson
  {
    fromNodeId: people.BRIAN_WILSON.id,
    toNodeId: concepts.FITNESS.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'profession',
    },
  },
  {
    fromNodeId: people.BRIAN_WILSON.id,
    toNodeId: concepts.RUGBY.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'sport',
    },
  },
  // Karen Davis
  {
    fromNodeId: people.KAREN_DAVIS.id,
    toNodeId: concepts.PHOTOGRAPHY.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'nature',
    },
  },
  {
    fromNodeId: people.KAREN_DAVIS.id,
    toNodeId: concepts.HIKING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'passion',
    },
  },

  // ==========================================
  // JOHN'S REMAINING COWORKERS
  // ==========================================
  // Emily White
  {
    fromNodeId: people.EMILY_WHITE.id,
    toNodeId: concepts.HIKING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'hobby',
    },
  },
  {
    fromNodeId: people.EMILY_WHITE.id,
    toNodeId: concepts.TRAVEL.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'lifestyle',
    },
  },
  // Marcus Johnson
  {
    fromNodeId: people.MARCUS_JOHNSON.id,
    toNodeId: concepts.CYCLING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'hobby',
    },
  },
  {
    fromNodeId: people.MARCUS_JOHNSON.id,
    toNodeId: concepts.SOFTWARE_ENGINEERING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'profession',
    },
  },
  // Sarah Jenkins
  {
    fromNodeId: people.SARAH_JENKINS.id,
    toNodeId: concepts.PUZZLES.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'hobby',
    },
  },
  {
    fromNodeId: people.SARAH_JENKINS.id,
    toNodeId: concepts.BOARD_GAMES.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'hobby',
    },
  },
  {
    fromNodeId: people.SARAH_JENKINS.id,
    toNodeId: concepts.SOFTWARE_ENGINEERING.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'profession',
    },
  },
  // Lisa Patel
  {
    fromNodeId: people.LISA_PATEL.id,
    toNodeId: concepts.PSYCHOLOGY.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'interest',
    },
  },
  {
    fromNodeId: people.LISA_PATEL.id,
    toNodeId: concepts.DESIGN.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'profession',
    },
  },
  // Robert Vance
  {
    fromNodeId: people.ROBERT_VANCE.id,
    toNodeId: concepts.COOKING.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'gourmet',
    },
  },
  // Jennifer Wu
  {
    fromNodeId: people.JENNIFER_WU.id,
    toNodeId: concepts.SOFTWARE_ENGINEERING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'data science',
    },
  },
  {
    fromNodeId: people.JENNIFER_WU.id,
    toNodeId: concepts.CLASSICAL.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'piano',
    },
  },
  // Kevin O'Connor
  {
    fromNodeId: people.KEVIN_OCONNOR.id,
    toNodeId: concepts.SOFTWARE_ENGINEERING.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'profession',
    },
  },

  // ==========================================
  // SARAH'S REMAINING FRIENDS
  // ==========================================
  // Elena Rodriguez
  {
    fromNodeId: people.ELENA_RODRIGUEZ.id,
    toNodeId: concepts.PAINTING.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'art',
    },
  },
  {
    fromNodeId: people.ELENA_RODRIGUEZ.id,
    toNodeId: concepts.WINE.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'tasting',
    },
  },
  {
    fromNodeId: people.ELENA_RODRIGUEZ.id,
    toNodeId: concepts.TRAVEL.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'interest',
    },
  },
  // Claire Thompson
  {
    fromNodeId: people.CLAIRE_THOMPSON.id,
    toNodeId: concepts.READING.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'literature',
    },
  },
  {
    fromNodeId: people.CLAIRE_THOMPSON.id,
    toNodeId: concepts.PAINTING.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'hobby',
    },
  },
  // Rachel Bennett
  {
    fromNodeId: people.RACHEL_BENNETT.id,
    toNodeId: concepts.DESIGN.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'interior',
    },
  },
  {
    fromNodeId: people.RACHEL_BENNETT.id,
    toNodeId: concepts.COOKING.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'hobby',
    },
  },
  // Jessica Miller
  {
    fromNodeId: people.JESSICA_MILLER.id,
    toNodeId: concepts.POLITICS.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'profession',
    },
  },
  {
    fromNodeId: people.JESSICA_MILLER.id,
    toNodeId: concepts.TRAVEL.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'interest',
    },
  },
  {
    fromNodeId: people.JESSICA_MILLER.id,
    toNodeId: concepts.PHOTOGRAPHY.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'hobby',
    },
  },
  // Mark O'Connell
  {
    fromNodeId: people.MARK_OCONNELL.id,
    toNodeId: concepts.CYCLING.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'friend activity',
    },
  },
  {
    fromNodeId: people.MARK_OCONNELL.id,
    toNodeId: concepts.COOKING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'passion',
    },
  },
  {
    fromNodeId: people.MARK_OCONNELL.id,
    toNodeId: concepts.DESIGN.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'profession',
    },
  },

  // ==========================================
  // SARAH'S REMAINING COWORKERS
  // ==========================================
  // Chloe Masters
  {
    fromNodeId: people.CHLOE_MASTERS.id,
    toNodeId: concepts.SOCIAL_MEDIA.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'trends',
    },
  },
  {
    fromNodeId: people.CHLOE_MASTERS.id,
    toNodeId: concepts.FASHION.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'hobby',
    },
  },
  // Brad Reynolds
  {
    fromNodeId: people.BRAD_REYNOLDS.id,
    toNodeId: concepts.GOLF.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'hobby',
    },
  },
  {
    fromNodeId: people.BRAD_REYNOLDS.id,
    toNodeId: concepts.PSYCHOLOGY.id,
    type: RelationshipType.PREFERS,
    strength: 0.75,
    properties: {
      context: 'sales',
    },
  },
  // Elias Vance
  {
    fromNodeId: people.ELIAS_VANCE.id,
    toNodeId: concepts.READING.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'literature',
    },
  },
  {
    fromNodeId: people.ELIAS_VANCE.id,
    toNodeId: concepts.WRITING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'profession',
    },
  },
  {
    fromNodeId: people.ELIAS_VANCE.id,
    toNodeId: concepts.JAZZ.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'interest',
    },
  },
  // Katherine O'Malley
  {
    fromNodeId: people.KATHERINE_OMALLEY.id,
    toNodeId: concepts.WINE.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'hobby',
    },
  },
  // Sam Rivera
  {
    fromNodeId: people.SAM_RIVERA.id,
    toNodeId: concepts.GAMING.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'hobby',
    },
  },
  // Grace Sterling
  {
    fromNodeId: people.GRACE_STERLING.id,
    toNodeId: concepts.POLITICS.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'news',
    },
  },
  // Morgan Wells
  {
    fromNodeId: people.MORGAN_WELLS.id,
    toNodeId: concepts.DESIGN.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'interior',
    },
  },

  // ==========================================
  // EMMA'S REMAINING FRIENDS
  // ==========================================
  // Lily Chen
  {
    fromNodeId: people.LILY_CHEN.id,
    toNodeId: concepts.WRITING.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'blogging',
    },
  },
  {
    fromNodeId: people.LILY_CHEN.id,
    toNodeId: concepts.DESIGN.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'graphic',
    },
  },
  {
    fromNodeId: people.LILY_CHEN.id,
    toNodeId: concepts.SOCIAL_MEDIA.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'interest',
    },
  },
  // Chloe Lewis
  {
    fromNodeId: people.CHLOE_LEWIS.id,
    toNodeId: concepts.WRITING.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'journalism',
    },
  },
  {
    fromNodeId: people.CHLOE_LEWIS.id,
    toNodeId: concepts.ACTIVISM.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'feminism',
    },
  },

  // ==========================================
  // LUCAS'S REMAINING FRIENDS
  // ==========================================
  // Sam Jenkins
  {
    fromNodeId: people.SAM_JENKINS.id,
    toNodeId: concepts.CYCLING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'fun',
    },
  },
  // Noah Kim
  {
    fromNodeId: people.NOAH_KIM.id,
    toNodeId: concepts.COMEDY.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'personality',
    },
  },
  // Tyler Brown
  {
    fromNodeId: people.TYLER_BROWN.id,
    toNodeId: concepts.PAINTING.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'drawing',
    },
  },
  {
    fromNodeId: people.TYLER_BROWN.id,
    toNodeId: concepts.BASKETBALL.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'sport',
    },
  },
  {
    fromNodeId: people.TYLER_BROWN.id,
    toNodeId: concepts.READING.id,
    type: RelationshipType.PREFERS,
    strength: 0.75,
    properties: {
      context: 'hobby',
    },
  },
  // Liam Patel
  {
    fromNodeId: people.LIAM_PATEL.id,
    toNodeId: concepts.PUZZLES.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'hobby',
    },
  },
  {
    fromNodeId: people.LIAM_PATEL.id,
    toNodeId: concepts.BOARD_GAMES.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'hobby',
    },
  },
];
