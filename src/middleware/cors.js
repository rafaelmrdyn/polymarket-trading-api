const cors = require('cors');

// Parse CORS origins from environment variable or use defaults
const getCorsOrigins = () => {
  if (process.env.CORS_ORIGIN) {
    // Support comma-separated list of origins
    return process.env.CORS_ORIGIN.split(',').map(origin => origin.trim());
  }
  
  if (process.env.NODE_ENV === 'production') {
    return process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [];
  }
  
  // Default development origins
  return ['http://localhost:3000', 'http://localhost:3001'];
};

const corsOptions = {
  origin: getCorsOrigins(),
  credentials: true,
  optionsSuccessStatus: 200
};

module.exports = cors(corsOptions);

