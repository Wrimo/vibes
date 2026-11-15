plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.vibes.brick"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.vibes.brick"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    // One fixed key, checked in, so an APK built anywhere (CI, either laptop)
    // installs over the previous one without wiping the app's state.
    signingConfigs {
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
}

// `./gradlew test -Pbrick.snapshots=<dir>` also saves a PNG of each screen.
tasks.withType<Test>().configureEach {
    (findProperty("brick.snapshots") as String?)?.let { systemProperty("brick.snapshots", it) }
}
