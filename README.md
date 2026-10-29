# EMP Emergencias — APK Android

## Cómo buildear la APK

La APK se buildea automáticamente en GitHub Actions cada vez que se hace push al repo.

### Pasos

1. Hacé push de tus cambios a la rama `main`.
2. Andá a la pestaña **Actions** del repo en GitHub.
3. Click en el workflow **"Build Android APK"** más reciente.
4. Esperá a que termine (5-10 minutos).
5. En la sección **Artifacts**, descargá `emp-emergencias-debug-apk`.
6. Descomprimí el ZIP y obtenés `app-debug.apk`.

### Instalación en Android

1. Transferí el APK al teléfono (por WhatsApp, email, Google Drive, cable USB).
2. Abrí el archivo desde el gestor de archivos.
3. Android va a pedir permiso para instalar apps de origen desconocido. Habilitalo.
4. Click en **Instalar**.

### Configuración de notificaciones

1. Al abrir la app por primera vez, va a pedir permiso de notificaciones. Aceptá.
2. En Android 12+, también va a pedir permiso de **alarmas exactas**. Aceptá.
3. Cuando cargues una medicación con horarios, la app va a programar las notificaciones automáticamente.
4. Los recordatorios van a sonar incluso con la app cerrada.

### Limitaciones

- **Android solamente.** iOS requiere Mac + Xcode + cuenta Apple Developer.
- **Sideload:** la APK no está en Play Store. Se instala manualmente.
- **Sonido:** usa el sonido por defecto del sistema. Para sonido custom, hay que agregar un archivo `.wav` en `android/app/src/main/res/raw/`.
