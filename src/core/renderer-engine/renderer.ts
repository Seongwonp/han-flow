import { NormalizedDocument, NormalizedSection, NormalizedParagraph, NormalizedTextRun, NormalizedTable, NormalizedControl } from "../../shared/types";

/**
 * 정규화된 HWPX 문서를 HTML/SVG/Canvas 요소로 렌더링하는 함수.
 * @param document 정규화된 문서 객체
 * @param targetElement 렌더링될 DOM 요소 (HTMLDivElement 등)
 */
export function renderDocument(document: NormalizedDocument, targetElement: HTMLElement): void {
  console.log("Rendering document...");
  targetElement.innerHTML = ""; // 기존 내용 초기화

  document.sections.forEach((section: NormalizedSection, sectionIndex: number) => {
    const sectionDiv = document.createElement("div");
    sectionDiv.className = `document-section section-${sectionIndex}`;
    targetElement.appendChild(sectionDiv);

    section.paragraphs.forEach((paragraph: NormalizedParagraph, paragraphIndex: number) => {
      const paragraphElement = document.createElement("p");
      paragraphElement.className = `document-paragraph paragraph-${paragraphIndex}`;
      // TODO: 단락 스타일 적용 (paraProperties 참조)
      sectionDiv.appendChild(paragraphElement);

      paragraph.content.forEach(contentElement => {
        if (contentElement.type === "text") {
          const span = document.createElement("span");
          span.textContent = (contentElement as NormalizedTextRun).text;
          // TODO: 글자 스타일 적용 (charProperties 참조)
          paragraphElement.appendChild(span);
        } else if (contentElement.type === "table") {
          const table = document.createElement("table");
          // TODO: 테이블 렌더링 로직 구현 (NormalizedTable 참조)
          paragraphElement.appendChild(table);
        } else if (contentElement.type === "control") {
          const controlDiv = document.createElement("div");
          controlDiv.className = "document-control";
          // TODO: 컨트롤 렌더링 로직 구현 (NormalizedControl 참조)
          paragraphElement.appendChild(controlDiv);
        }
      });
    });
  });
}

// TODO: 스타일 적용을 위한 헬퍼 함수 및 CSS 클래스 정의 필요
