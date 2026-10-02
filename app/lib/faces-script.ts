export const FACES_SCRIPT = `
      addEventListener("load", () => {
        const injectFaces = () => {
          const faces = document.createElement("link");
          faces.rel = "stylesheet";
          faces.href = "/home-faces.css";
          document.body.appendChild(faces);
        };
        let frames = 0;
        const whenPainted = () =>
          performance.getEntriesByName("first-contentful-paint").length || ++frames > 120
            ? injectFaces()
            : requestAnimationFrame(whenPainted);
        requestAnimationFrame(whenPainted);
      });
    `;
