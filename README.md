# SMX1-IA-Isaias
Esto es un repositorio para alojar mis proyectos de codigo de la asignatura MOP01.

## Backend de verificación de pago
Se ha añadido un servidor Node.js que permite:
- registrar e iniciar sesión de usuarios
- crear sesiones de pago con Stripe
- verificar pagos con webhook y actualizar el rol del usuario a `premium`
- mantener el rol `free` si el pago no se confirma o se cancela

### Puesta en marcha
1. Copia `.env.example` a `.env`.
2. Configura `JWT_SECRET`, `BASE_URL`, `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET`.
3. Instala dependencias:
   ```bash
   npm install
   ```
4. Inicia el servidor:
   ```bash
   npm start
   ```

### Notas
- El frontend de `Pagina 2.html` ahora llama al backend para crear la sesión de pago.
- La actualización de rol ocurre sólo después de que Stripe confirme el pago mediante webhook.
