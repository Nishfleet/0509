export const FACES_SCRIPT = `
      addEventListener("load", () => {
        const faces = document.createElement("link");
        faces.rel = "stylesheet";
        faces.href = "/home-faces.css";
        document.body.appendChild(faces);
      });
    `;
