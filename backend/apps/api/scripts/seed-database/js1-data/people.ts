import { type CreatePersonDto } from '@ci/domains/memory/types';

type SeedPerson = RequiredFields<CreatePersonDto, 'id'>;

// Family members

export const JOHN_SMITH: SeedPerson = {
  id: '019b80f8-77e9-75fa-843e-42cab7b4c7d5',
  name: 'John Smith',
  description: 'Software engineer and family man who loves organizing family activities',
  properties: {
    first_name: 'John',
    last_name: 'Smith',
    age: 42,
    family_role: 'father',
    occupation: 'Software Engineer',
  },
};

export const SARAH_SMITH: SeedPerson = {
  id: '019b80f8-77ea-7088-a776-7c6ddfd5cfba',
  name: 'Sarah Smith',
  description: 'Marketing manager with a passion for healthy living and outdoor activities',
  properties: {
    first_name: 'Sarah',
    last_name: 'Smith',
    age: 40,
    family_role: 'mother',
    occupation: 'Marketing Manager',
  },
};

export const EMMA_SMITH: SeedPerson = {
  id: '019b80f8-77eb-75ea-829c-6cab32c2c4de',
  name: 'Emma Smith',
  description: 'High school student interested in art, music, and social causes',
  properties: {
    first_name: 'Emma',
    last_name: 'Smith',
    age: 14,
    family_role: 'daughter',
    occupation: 'Student',
  },
};

export const LUCAS_SMITH: SeedPerson = {
  id: '019b80f8-77ec-76f6-ae6d-af1795306f66',
  name: 'Lucas Smith',
  description: 'Elementary school student who loves sports, video games, and adventure',
  properties: {
    first_name: 'Lucas',
    last_name: 'Smith',
    age: 10,
    family_role: 'son',
    occupation: 'Student',
  },
};

// Co-workers

export const DAVID_CHEN: SeedPerson = {
  id: '019b80f8-77ed-7824-8c18-1a8146d91495',
  name: 'David Chen',
  description: 'Senior Frontend Engineer who loves specialty coffee and clean code',
  properties: {
    first_name: 'David',
    last_name: 'Chen',
    age: 35,
    occupation: 'Senior Frontend Engineer',
    interests: ['Coffee', 'Coding', 'Design'],
  },
};

export const EMILY_WHITE: SeedPerson = {
  id: '019b80f8-77ef-7daa-af7f-5f512e00d2e1',
  name: 'Emily White',
  description: 'Product Manager who keeps the team on track and loves hiking',
  properties: {
    first_name: 'Emily',
    last_name: 'White',
    age: 38,
    occupation: 'Product Manager',
    interests: ['Hiking', 'Organization', 'Travel'],
  },
};

export const MARCUS_JOHNSON: SeedPerson = {
  id: '019b80f8-77f0-7f1b-8dd0-83185cc8759e',
  name: 'Marcus Johnson',
  description: 'DevOps Specialist who enjoys cycling to work',
  properties: {
    first_name: 'Marcus',
    last_name: 'Johnson',
    age: 40,
    occupation: 'DevOps Engineer',
    interests: ['Cycling', 'Technology', 'Automation'],
  },
};

// John Smith's friends

export const TOM_WILSON: SeedPerson = {
  id: '019b80f8-77f1-72cc-9bd4-938fc879daa7',
  name: 'Tom Wilson',
  description: 'Hiking partner and fellow craft beer enthusiast',
  properties: {
    first_name: 'Tom',
    last_name: 'Wilson',
    age: 43,
    occupation: 'Architect',
    interests: ['Hiking', 'Beer', 'Outdoors'],
  },
};

export const JESSICA_LEE: SeedPerson = {
  id: '019b80f8-77f2-7331-ada3-7dd6e0b403ed',
  name: 'Jessica Lee',
  description: 'Neighbor and family friend whose kids go to the same school',
  properties: {
    first_name: 'Jessica',
    last_name: 'Lee',
    age: 39,
    occupation: 'Teacher',
    interests: ['Family', 'Reading', 'Gardening'],
  },
};

export const CHRIS_MARTIN: SeedPerson = {
  id: '019b80f8-77f3-7724-8b4d-6de450468ad2',
  name: 'Chris Martin',
  description: 'Cycling buddy who organizes weekend rides',
  properties: {
    first_name: 'Chris',
    last_name: 'Martin',
    age: 41,
    occupation: 'Financial Analyst',
    interests: ['Cycling', 'Fitness', 'Finance'],
  },
};

export const SARAH_JENKINS: SeedPerson = {
  id: '019b80f8-77f4-7346-aaf0-d1afdf4f027d',
  name: 'Sarah Jenkins',
  description: 'QA Engineer with an eagle eye for bugs and details',
  properties: {
    first_name: 'Sarah',
    last_name: 'Jenkins',
    age: 29,
    occupation: 'QA Engineer',
    interests: ['Testing', 'Puzzles', 'Board Games'],
  },
};

export const MICHAEL_CHANG: SeedPerson = {
  id: '019b80f8-77f6-7575-8c8b-2c54be58ec03',
  name: 'Michael Chang',
  description: 'Backend Engineer focused on API design and scalability',
  properties: {
    first_name: 'Michael',
    last_name: 'Chang',
    age: 32,
    occupation: 'Backend Engineer',
    interests: ['Scalability', 'Gaming', 'Sci-Fi'],
  },
};

export const LISA_PATEL: SeedPerson = {
  id: '019b80f8-77f7-70d3-a281-77e4bd8e9d60',
  name: 'Lisa Patel',
  description: 'UX Designer who advocates for user-centric interfaces',
  properties: {
    first_name: 'Lisa',
    last_name: 'Patel',
    age: 28,
    occupation: 'UX Designer',
    interests: ['Design', 'Art', 'Psychology'],
  },
};

export const ROBERT_VANCE: SeedPerson = {
  id: '019b80f8-77f8-70b0-8e5c-ddc6ee79f0c3',
  name: 'Robert Vance',
  description: 'Engineering Manager who supports the team and removes blockers',
  properties: {
    first_name: 'Robert',
    last_name: 'Vance',
    age: 45,
    occupation: 'Engineering Manager',
    interests: ['Leadership', 'Golf', 'Cooking'],
  },
};

export const JENNIFER_WU: SeedPerson = {
  id: '019b80f8-77f9-70f8-af03-a37e8995c77c',
  name: 'Jennifer Wu',
  description: 'Data Scientist working on the new recommendation engine',
  properties: {
    first_name: 'Jennifer',
    last_name: 'Wu',
    age: 31,
    occupation: 'Data Scientist',
    interests: ['Machine Learning', 'Statistics', 'Piano'],
  },
};

export const KEVIN_OCONNOR: SeedPerson = {
  id: '019b80f8-77fb-7c2d-933e-79e69c11b135',
  name: "Kevin O'Connor",
  description: 'SysAdmin who keeps the servers running and loves hardware',
  properties: {
    first_name: 'Kevin',
    last_name: "O'Connor",
    age: 36,
    occupation: 'System Administrator',
    interests: ['Linux', 'Hardware', 'Motorcycles'],
  },
};

export const RACHEL_GREEN: SeedPerson = {
  id: '019b80f8-77fc-7548-bcc2-cb5d409f90e3',
  name: 'Rachel Green',
  description: 'Scrum Master who facilitates agile processes and team health',
  properties: {
    first_name: 'Rachel',
    last_name: 'Green',
    age: 33,
    occupation: 'Scrum Master',
    interests: ['Agile', 'Yoga', 'Meditation'],
  },
};

export const MARK_THOMPSON: SeedPerson = {
  id: '019b80f8-77fd-75d4-863f-29dde0880cac',
  name: 'Mark Thompson',
  description: 'College buddy who brews his own beer',
  properties: {
    first_name: 'Mark',
    last_name: 'Thompson',
    age: 42,
    occupation: 'Accountant',
    interests: ['Beer Brewing', 'College Football', 'Grilling'],
  },
};

export const LAURA_GARCIA: SeedPerson = {
  id: '019b80f8-77fe-7c94-9982-67946f4e64bb',
  name: 'Laura Garcia',
  description: 'Member of the local book club and avid reader',
  properties: {
    first_name: 'Laura',
    last_name: 'Garcia',
    age: 38,
    occupation: 'Librarian',
    interests: ['Reading', 'Literature', 'History'],
  },
};

export const STEVE_MILLER: SeedPerson = {
  id: '019b80f8-77ff-7165-9d58-c2baf9e33346',
  name: 'Steve Miller',
  description: 'Cycling enthusiast who rides in the same weekend group',
  properties: {
    first_name: 'Steve',
    last_name: 'Miller',
    age: 44,
    occupation: 'Sales Director',
    interests: ['Cycling', 'Travel', 'Wine'],
  },
};

export const AMANDA_BROWN: SeedPerson = {
  id: '019b80f8-7801-7dbb-82c2-a203f66ed680',
  name: 'Amanda Brown',
  description: "Parent from the kids' school, often coordinates playdates",
  properties: {
    first_name: 'Amanda',
    last_name: 'Brown',
    age: 39,
    occupation: 'Freelance Writer',
    interests: ['Parenting', 'Writing', 'Volunteering'],
  },
};

export const BRIAN_WILSON: SeedPerson = {
  id: '019b80f8-7802-7761-a918-9314dd01f61d',
  name: 'Brian Wilson',
  description: 'Gym buddy who spots John on bench press',
  properties: {
    first_name: 'Brian',
    last_name: 'Wilson',
    age: 30,
    occupation: 'Personal Trainer',
    interests: ['Fitness', 'Nutrition', 'Sports'],
  },
};

export const KAREN_DAVIS: SeedPerson = {
  id: '019b80f8-7803-77fd-8d51-42dad9562413',
  name: 'Karen Davis',
  description: 'Hiking group organizer who knows all the best trails',
  properties: {
    first_name: 'Karen',
    last_name: 'Davis',
    age: 46,
    occupation: 'Geologist',
    interests: ['Hiking', 'Nature', 'Photography'],
  },
};

export const PAUL_ANDERSON: SeedPerson = {
  id: '019b80f8-7804-7e02-966d-2e092c1c3c11',
  name: 'Paul Anderson',
  description: 'Regular at the local coffee shop, always up for a chat',
  properties: {
    first_name: 'Paul',
    last_name: 'Anderson',
    age: 55,
    occupation: 'Retired',
    interests: ['Coffee', 'Politics', 'Chess'],
  },
};

export const FAMILY = [JOHN_SMITH, SARAH_SMITH, EMMA_SMITH, LUCAS_SMITH];

export const COWORKERS: SeedPerson[] = [
  DAVID_CHEN,
  EMILY_WHITE,
  MARCUS_JOHNSON,
  SARAH_JENKINS,
  MICHAEL_CHANG,
  LISA_PATEL,
  ROBERT_VANCE,
  JENNIFER_WU,
  KEVIN_OCONNOR,
  RACHEL_GREEN,
];

export const FRIENDS: SeedPerson[] = [
  TOM_WILSON,
  JESSICA_LEE,
  CHRIS_MARTIN,
  MARK_THOMPSON,
  LAURA_GARCIA,
  STEVE_MILLER,
  AMANDA_BROWN,
  BRIAN_WILSON,
  KAREN_DAVIS,
  PAUL_ANDERSON,
];

export const PEOPLE: SeedPerson[] = [...FAMILY, ...COWORKERS, ...FRIENDS];
