import { env } from './config/env.js'
import { app } from './app.js'

app.listen(Number(env.PORT), () => {
  console.log(`Backend API listening on http://localhost:${env.PORT}`)
})

