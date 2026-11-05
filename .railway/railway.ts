import { defineRailway, github, project, redis, service } from 'railway/iac';

export default defineRailway((ctx) => {
  const cache = redis('blackops-redis');
  const web = service('Laverite', {
    source: github('falmonmickael260-commits/Laverite', { branch: 'main' }),
    start: 'npm start',
    healthcheck: '/api/health',
    healthcheckTimeout: 60,
    replicas: 1,
    env: {
      NODE_ENV: 'production',
      REDIS_URL: cache.env.REDIS_URL,
      SESSION_HOURS: '24',
      MAX_UPLOAD_BYTES: '3000000'
    }
  });
  return project(ctx.projectName || 'blackops-action-verite', { resources: [cache, web] });
});
