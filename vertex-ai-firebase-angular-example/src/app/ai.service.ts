/*!
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */
import { Injectable, Inject, inject } from "@angular/core";
import { FirebaseApp } from "@angular/fire/app";
import {
  getVertexAI,
  getGenerativeModel,
  GenerativeModel,
  ChatSession,
  FunctionDeclarationsTool,
  ObjectSchemaInterface,
  Schema,
  FunctionCall,
  GenerateContentResult,
} from "@angular/fire/vertexai";
import { ProductService } from "./product.service";
import { Product } from "./product";

@Injectable({
  providedIn: "root",
})
export class AiService {
  private readonly model: GenerativeModel;
  private readonly products: ProductService = inject(ProductService);
  private readonly chat: ChatSession;

  constructor(@Inject("FIREBASE_APP") private firebaseApp: FirebaseApp) {
    const productsToolSet: FunctionDeclarationsTool = {
      functionDeclarations: [
        {
          name: "filterProducts",
          description: `Update the visible inventory by filtering the available products. 
            This will not change the cart.functions requires an array of products to filter by.
            Returns a list of filtered products.`,
          parameters: Schema.object(({
            properties: {
              productsToFilter: Schema.array({
                items: Schema.object({
                  description: "A single product with its name.",
                  properties: {
                    name: Schema.string({
                      description: "The name of the product.",
                    }),
                  },
                  required: ["name"],
                }),
              }),
            },
          })) as ObjectSchemaInterface,
        },
        {
          name: "getNumberOfProducts",
          description:
            "Get a count of the number of products available in the inventory.",
        },
        {
          name: "getProducts",
          description:
            "Get an array of the products with the name and price of each product.",
        },
        {
          name: "addToCart",
          description: "Add one or more products to the cart.",
          parameters: Schema.object({
            properties: {
              productsToAdd: Schema.array({
                items: Schema.object({
                  description: "A single product with its name.",
                  properties: {
                    name: Schema.string({
                      description: "The name of the product.",
                    }),
                  },
                  required: ["name"],
                }),
              }),
            },
          }) as ObjectSchemaInterface,
        },
        {
          name: "removeFromCart",
          description: "Remove one or more products from the cart.",
          parameters: Schema.object({
            properties: {
              productsToRemove: Schema.array({
                items: Schema.object({
                  description: "A single product with its name.",
                  properties: {
                    name: Schema.string({
                      description: "The name of the product.",
                    }),
                  },
                  required: ["name"],
                }),
              }),
            },
          }) as ObjectSchemaInterface,
        },
      ],
    };

    // Initialize the Vertex AI service
    const vertexAI = getVertexAI(this.firebaseApp);
    const systemInstruction =
      `Welcome to ng-produce. You are a superstar agent for this ecommerce store. 
      you will assist users by answering questions about the inventory and even being able to add items to the cart.
      If you are asked to out ingredients to make a recipe, you can get first get the inverntory which containes the items and the price for those items.;
  `;
    // Initialize the generative model with a model that supports your use case
    this.model = getGenerativeModel(vertexAI, {
      model: "gemini-2.5-pro-preview-03-25",
      systemInstruction: systemInstruction,
      tools: [productsToolSet],
    });

    this.chat = this.model.startChat();
  }

  async callFunctions(
    functionCalls: FunctionCall[]
  ): Promise<GenerateContentResult> {
    let result;

    for (const functionCall of functionCalls) {
      if (functionCall.name === "getProducts") {
        const functionResult = this.getProducts();
        result = await this.chat.sendMessage([
          {
            functionResponse: {
              name: functionCall.name,
              response: { products: functionResult },
            },
          },
        ]);
        let fnCalls = result.response.functionCalls();
        if (fnCalls && fnCalls.length > 0) {
          // Call the functions recursively
          return this.callFunctions(fnCalls);
        }
      }

      if (functionCall.name === "filterProducts") {
        // This function takes an array of products to filter, so we need to get the args
        const args = functionCall.args as { productsToFilter: Product[] };
        const functionResult = this.filterProducts(args.productsToFilter);

        result = await this.chat.sendMessage([
          {
            functionResponse: {
              name: functionCall.name,
              response: { numberOfProductsFiltered: functionResult },
            },
          },
        ]);
        const fnCalls = result.response.functionCalls();
        if (fnCalls && fnCalls.length > 0) {
          // Call the functions recursively
          return this.callFunctions(fnCalls);
        }
      }

      if (functionCall.name === "addToCart") {
        const args = functionCall.args as { productsToAdd: Product[] };

        const functionResult = this.addToCart(args.productsToAdd);

        result = await this.chat.sendMessage([
          {
            functionResponse: {
              name: functionCall.name,
              response: { numberOfProductsAdded: functionResult },
            },
          },
        ]);
        let fnCalls = result.response.functionCalls();
        if (fnCalls && fnCalls.length > 0) {
          // Call the functions recursively
          return this.callFunctions(fnCalls);
        }
      }

      if (functionCall.name === "getNumberOfProducts") {
        // This function does not take any arguments, so we can call it directly
        // and return the result.
        const functionResult = this.getNumberOfProducts();
        result = await this.chat.sendMessage([
          {
            functionResponse: {
              name: functionCall.name,
              response: { numberOfItems: functionResult },
            },
          },
        ]);
        let fnCalls = result.response.functionCalls();
        if (fnCalls && fnCalls.length > 0) {
          // Call the functions recursively
          return this.callFunctions(fnCalls);
        }
      }

      if (functionCall.name === "removeFromCart") {
        // This function takes an array of products to remove, so we need to get the args
        const args = functionCall.args as {
          productsToRemove: { name: string }[];
        };

        // Call the function and get the result
        const functionResult = this.removeFromCart(args.productsToRemove);

        // Send the result back to the chat
        result = await this.chat.sendMessage([
          {
            functionResponse: {
              name: functionCall.name,
              response: { numberOfProductsRemoved: functionResult },
            },
          },
        ]);
        let fnCalls = result.response.functionCalls();
        if (fnCalls && fnCalls.length > 0) {
          // Call the functions recursively
          return this.callFunctions(fnCalls);
        }
      }
    }

    return result!;
  }
  async ask(prompt: string) {
    let result = await this.chat.sendMessage(prompt);
    const functionCalls = result.response.functionCalls();

    if (functionCalls && functionCalls.length > 0) {
      result = await this.callFunctions(functionCalls);
    }

    return result.response.text();
  }

  getProducts() {
    return this.products.getProducts();
  }
  getNumberOfProducts() {
    return this.getProducts().length;
  }
  filterProducts(productsToFilter: Product[]): void {
    this.products.filterCriteria.set(productsToFilter);
  }

  addToCart(productsToAdd: Product[]): number {
    for (let i = 0; i < productsToAdd.length; i++) {
      this.products.addToCart(productsToAdd[i].name);
    }
    return productsToAdd.length;
  }

  removeFromCart(productsToRemove: { name: string }[]): number {
    let count = 0;
    for (let i = 0; i < productsToRemove.length; i++) {
      if (this.products.removeFromCart(productsToRemove[i].name)) {
        count++;
      }
    }
    return count;
  }
}
