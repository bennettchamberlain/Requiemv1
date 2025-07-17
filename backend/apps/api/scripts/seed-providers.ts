import { DataSource } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

export async function seedProviders(db: DataSource) {
  const providerRepo = db.getRepository('providers');
  
  // Check if Google provider already exists
  const existingGoogle = await providerRepo.findOne({
    where: { name: 'Google' }
  });
  
  if (!existingGoogle) {
    // Create Google provider with OAuth2 configuration
    await providerRepo.save({
      id: uuid7(),
      name: 'Google',
      tokenHost: 'https://oauth2.googleapis.com',
      tokenPath: '/token',
      authorizePath: '/o/oauth2/v2/auth',
      apiBaseUrl: 'https://www.googleapis.com',
      scopes: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly',
      created_at: new Date(),
      updated_at: new Date(),
    });
    
    console.log('Created Google provider');
  }
  
  // Add more providers as needed
  const providers = [
    {
      name: 'Microsoft',
      tokenHost: 'https://login.microsoftonline.com',
      tokenPath: '/common/oauth2/v2.0/token',
      authorizePath: '/common/oauth2/v2.0/authorize',
      apiBaseUrl: 'https://graph.microsoft.com',
      scopes: 'https://graph.microsoft.com/.default',
    },
    {
      name: 'GitHub',
      tokenHost: 'https://github.com',
      tokenPath: '/login/oauth/access_token',
      authorizePath: '/login/oauth/authorize',
      apiBaseUrl: 'https://api.github.com',
      scopes: 'read:user user:email',
    },
  ];
  
  for (const provider of providers) {
    const existing = await providerRepo.findOne({
      where: { name: provider.name }
    });
    
    if (!existing) {
      await providerRepo.save({
        id: uuid7(),
        ...provider,
        created_at: new Date(),
        updated_at: new Date(),
      });
      
      console.log(`Created ${provider.name} provider`);
    }
  }
}

// If running directly
if (require.main === module) {
  const { AppDataSource } = require('../src/data-source');
  
  AppDataSource.initialize()
    .then(async () => {
      await seedProviders(AppDataSource);
      await AppDataSource.destroy();
    })
    .catch((error: any) => console.error(error));
}
