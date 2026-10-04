buildscript {
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://maven.mappls.com/repository/mappls/") }
    }

    dependencies {
        classpath("com.mappls.services:mappls-services:1.0.0")
    }
}


val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
